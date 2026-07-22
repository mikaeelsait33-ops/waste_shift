import { useCallback, useEffect } from 'react';
import { inferRoleKey, requirePermission } from '../utils/accessControl';
import { inferStaffSection } from '../utils/staffSections';
import {
  createPinRecord,
  sanitizeAuthSettings,
  sanitizePinRecord,
  verifyPin,
} from '../utils/pinAuth';
import {
  STAFF_SECTION_ROLE_LABELS,
  createAuditLogEntry,
  createStaffMemberId,
} from '../utils/appData';
import { getClientDatabaseId } from '../utils/clientDatabaseId';
import { clearPersistedAuthSession } from '../utils/sessionPersistence';
import { saveCurrentUserStaffProfile } from '../services/firebaseAccess';
import { saveManagerAccount } from '../services/managerAccounts';
import {
  establishManagerSession,
  recoverManagerSession,
  revokeManagerSession,
} from '../services/managerSession';
import {
  establishStaffSession,
  revokeStaffSession,
  saveStaffAccessAccount,
} from '../services/staffSession';

export function useStaffAccess({
  accessProfile,
  activeStaffId,
  activeStaffMember,
  authSession,
  authSettings,
  baseStaffList,
  restaurantName,
  setActiveStaffId,
  setActiveTab,
  setAuditLog,
  setAuthSession,
  setAuthSettings,
  setCustomStaffList,
  setIsPreparingAuth,
  setSyncAccessKey,
  staffList,
}) {
  const handleSavePinSettings = useCallback(async ({ staffPin, managementPin, pinPresetVersion = 'custom' }) => {
    const nextAuthSettings = { ...authSettings };
    const trimmedStaffPin = String(staffPin || '').trim();
    const trimmedManagementPin = String(managementPin || '').trim();

    try {
      if (trimmedStaffPin) {
        nextAuthSettings.staffPin = await createPinRecord(trimmedStaffPin);
      }

      let updatedManager = null;

      if (trimmedManagementPin) {
        const activeManager = staffList.find((member) => (
          member.id === activeStaffId
          && (member.staffSection === 'management' || inferRoleKey(member.role) === 'manager' || inferRoleKey(member.role) === 'owner')
        ));

        if (!activeManager) {
          return { ok: false, message: 'Log in as a manager before changing a manager PIN.' };
        }

        updatedManager = {
          ...activeManager,
          managerPin: await createPinRecord(trimmedManagementPin),
          staffSection: 'management',
          role: activeManager.role || 'Manager',
          isCsvSeed: false,
        };

        setCustomStaffList(prevStaffList => {
          const existingIndex = prevStaffList.findIndex((member) => member.id === updatedManager.id);

          if (existingIndex === -1) {
            return [...prevStaffList, updatedManager];
          }

          return prevStaffList.map((member, index) => (
            index === existingIndex ? { ...member, ...updatedManager } : member
          ));
        });

        saveManagerAccount(updatedManager).catch((error) => {
          console.warn('Could not save manager account to Firestore.', error);
        });
      }

      nextAuthSettings.managementPin = null;
      nextAuthSettings.updatedAt = new Date().toISOString();
      nextAuthSettings.pinPresetVersion = pinPresetVersion;
      setAuthSettings(sanitizeAuthSettings(nextAuthSettings));
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'PIN settings changed',
          user: activeStaffMember?.name || 'System',
          relatedItem: 'Access settings',
          afterValue: {
            staffPinsEnabled: true,
            managerAccountUpdated: Boolean(updatedManager),
          },
        }),
        ...prevLog,
      ].slice(0, 500));

      return { ok: true, message: 'PIN settings saved.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not save PIN settings.' };
    }
  }, [
    activeStaffId,
    activeStaffMember?.name,
    authSettings,
    setAuditLog,
    setAuthSettings,
    setCustomStaffList,
    staffList,
  ]);

  useEffect(() => {
    setIsPreparingAuth(false);
  }, [setIsPreparingAuth]);

  const upsertLoginAccount = useCallback(({ mode, name, staffSection, staffCode, managerPin }) => {
    const trimmedName = String(name || '').trim();
    const accountId = createStaffMemberId(trimmedName);
    const existingMember = staffList.find((member) => member.id === accountId);
    const nextMember = mode === 'management'
      ? {
        id: accountId,
        name: trimmedName,
        role: 'Manager',
        staffSection: 'management',
        managerPin: managerPin || existingMember?.managerPin || null,
        removed: false,
        removedAt: '',
        isCsvSeed: false,
      }
      : {
        id: accountId,
        name: trimmedName,
        role: STAFF_SECTION_ROLE_LABELS[staffSection] || 'Team',
        staffSection: staffSection || 'kitchen',
        staffCode: staffCode || existingMember?.staffCode || null,
        removed: false,
        removedAt: '',
        isCsvSeed: false,
      };

    setCustomStaffList(prevStaffList => {
      const existingIndex = prevStaffList.findIndex((member) => member.id === accountId);

      if (existingIndex === -1) {
        return [...prevStaffList, nextMember];
      }

      return prevStaffList.map((member, index) => (
        index === existingIndex
          ? {
            ...member,
            ...nextMember,
            staffCode: nextMember.staffCode || member.staffCode || existingMember?.staffCode || null,
            managerPin: nextMember.managerPin || member.managerPin || existingMember?.managerPin || null,
          }
          : member
      ));
    });

    return { ...existingMember, ...nextMember };
  }, [setCustomStaffList, staffList]);

  const handleInitialManagerSetup = useCallback(async ({ name, managementPin }) => {
    const trimmedName = String(name || '').trim();
    const trimmedManagementPin = String(managementPin || '').trim();

    if (!trimmedName) {
      return { ok: false, message: 'Enter the first manager name.' };
    }

    let managerPinRecord;

    try {
      managerPinRecord = await createPinRecord(trimmedManagementPin);
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not create manager PIN.' };
    }

    const managerMember = upsertLoginAccount({
      mode: 'management',
      name: trimmedName,
      managerPin: managerPinRecord,
    });
    await saveManagerAccount(managerMember).catch((error) => {
      console.warn('Could not save manager account to Firestore.', error);
    });
    await saveCurrentUserStaffProfile({
      displayName: managerMember.name,
      role: managerMember.role,
      roleKey: 'manager',
      staffId: managerMember.id,
    }).catch((error) => {
      console.warn('Could not save manager Firebase access profile.', error);
    });
    const managerSessionResult = await establishManagerSession({
      managerId: managerMember.id,
      pin: trimmedManagementPin,
    });

    if (!managerSessionResult.ok) {
      return { ok: false, message: managerSessionResult.message };
    }
    const nextSession = {
      mode: 'management',
      staffId: managerMember.id,
      staffName: managerMember.name,
      roleKey: inferRoleKey(managerMember.role),
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setAuthSession(nextSession);
    setActiveStaffId(managerMember.id);
    setActiveTab('settings');
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'First manager setup',
        user: managerMember.name,
        relatedItem: 'Access settings',
        afterValue: { staffId: managerMember.id, managerAccountCreated: true },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      message: managerSessionResult.ok
        ? 'Manager access created.'
        : `Manager access created. ${managerSessionResult.message}`,
    };
  }, [setActiveStaffId, setActiveTab, setAuditLog, setAuthSession, upsertLoginAccount]);

  const handleLogin = useCallback(async ({ mode, name, staffSection, pin }) => {
    const trimmedName = String(name || '').trim();
    let authenticatedStaffMember = null;
    let accessSessionResult = null;

    if (!trimmedName) {
      return { ok: false, message: mode === 'management' ? 'Enter your management name.' : 'Choose your staff profile.' };
    }

    if (mode === 'staff') {
      const accountId = createStaffMemberId(trimmedName);
      const existingMember = staffList.find((member) => member.id === accountId);

      if (!existingMember) {
        return { ok: false, message: 'Ask a manager to add you in Settings > Staff before logging in.' };
      }

      if (!/^\d{5}$/.test(String(pin || '').trim())) {
        return { ok: false, message: 'Enter your 5 digit staff PIN.' };
      }

      accessSessionResult = await establishStaffSession({ staffId: accountId, pin });
      if (!accessSessionResult.ok) {
        return { ok: false, message: accessSessionResult.message };
      }

      authenticatedStaffMember = existingMember;
    } else {
      const accountId = createStaffMemberId(trimmedName);
      const existingManager = staffList.find((member) => (
        member.id === accountId
        && !member.removed
        && (member.staffSection === 'management' || inferRoleKey(member.role) === 'manager' || inferRoleKey(member.role) === 'owner')
      ));
      accessSessionResult = await establishManagerSession({ managerId: accountId, pin });

      if (!accessSessionResult.ok) {
        return { ok: false, message: accessSessionResult.message };
      }

      authenticatedStaffMember = existingManager || upsertLoginAccount({
        mode,
        name: trimmedName,
        managerPin: null,
      });
    }

    const staffMember = authenticatedStaffMember || upsertLoginAccount({
      mode,
      name: trimmedName,
      staffSection,
    });
    const roleKey = inferRoleKey(staffMember.role);
    await saveCurrentUserStaffProfile({
      displayName: staffMember.name,
      role: staffMember.role,
      roleKey,
      staffId: staffMember.id,
    }).catch((error) => {
      console.warn('Could not save Firebase access profile.', error);
    });
    const nextSession = {
      mode,
      staffId: staffMember.id,
      staffName: staffMember.name,
      roleKey,
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setAuthSession(nextSession);
    setActiveStaffId(staffMember.id);
    setActiveTab(mode === 'management' ? 'dashboard' : 'logWaste');
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: `${mode === 'management' ? 'Management' : 'Staff'} login`,
        user: staffMember.name,
        relatedItem: 'PIN login',
        afterValue: { role: staffMember.role },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      message: 'Login successful.',
    };
  }, [setActiveStaffId, setActiveTab, setAuditLog, setAuthSession, staffList, upsertLoginAccount]);

  const handleRecoverManagerAccess = useCallback(async ({ name, pin, recoveryKey }) => {
    const managerName = String(name || '').trim();
    const managerId = createStaffMemberId(managerName);
    const result = await recoverManagerSession({ managerId, name: managerName, pin, recoveryKey });

    if (!result?.ok) {
      return { ok: false, message: result?.message || 'Could not recover manager access.' };
    }

    const managerMember = upsertLoginAccount({
      mode: 'management',
      name: managerName,
      managerPin: null,
    });
    await saveCurrentUserStaffProfile({
      displayName: managerMember.name,
      role: 'Manager',
      roleKey: 'manager',
      staffId: managerMember.id,
    }).catch((error) => {
      console.warn('Could not save recovered Firebase access profile.', error);
    });
    const nextSession = {
      mode: 'management',
      staffId: managerMember.id,
      staffName: managerMember.name,
      roleKey: 'manager',
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setAuthSession(nextSession);
    setActiveStaffId(managerMember.id);
    setActiveTab('dashboard');
    setAuditLog((currentLog) => [
      createAuditLogEntry({
        action: 'Legacy manager access recovered',
        user: managerMember.name,
        relatedItem: restaurantName || 'Restaurant',
      }),
      ...currentLog,
    ].slice(0, 500));

    return { ok: true, message: 'Manager access restored.' };
  }, [restaurantName, setActiveStaffId, setActiveTab, setAuditLog, setAuthSession, upsertLoginAccount]);

  const handlePrepareSetupManagerAccess = useCallback(async ({ name, managerPin }) => {
    const managerName = String(name || '').trim();
    const safeManagerPin = String(managerPin || '').trim();

    if (!managerName || !safeManagerPin) {
      return { ok: false, message: 'Enter the manager name and PIN first.' };
    }

    try {
      const managerMember = {
        id: createStaffMemberId(managerName),
        name: managerName,
        role: 'Manager',
        staffSection: 'management',
        managerPin: await createPinRecord(safeManagerPin),
        removed: false,
        removedAt: '',
        isCsvSeed: false,
      };

      await saveManagerAccount(managerMember);
      await saveCurrentUserStaffProfile({
        displayName: managerMember.name,
        role: managerMember.role,
        roleKey: 'manager',
        staffId: managerMember.id,
      });
      const managerSessionResult = await establishManagerSession({
        managerId: managerMember.id,
        pin: safeManagerPin,
      });

      return {
        ok: managerSessionResult.ok,
        message: managerSessionResult.ok ? '' : managerSessionResult.message,
      };
    } catch (error) {
      const message = String(error?.message || '');
      const isPermissionError = error?.code === 'permission-denied'
        || message.toLowerCase().includes('missing or insufficient permissions');

      return {
        ok: false,
        message: isPermissionError
          ? 'Firestore rules are blocking manager setup. Deploy firestore.rules, then try again.'
          : message || 'Could not prepare manager access.',
      };
    }
  }, []);

  const handleLogout = useCallback(async () => {
    const previousSession = authSession;

    clearPersistedAuthSession();
    setAuthSession(null);
    setActiveStaffId('');
    setSyncAccessKey('');
    setActiveTab('dashboard');

    if (previousSession?.staffName) {
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Logout',
          user: previousSession.staffName,
          relatedItem: 'PIN session',
        }),
        ...prevLog,
      ].slice(0, 500));
    }

    const result = previousSession?.mode === 'management'
      ? await revokeManagerSession()
      : await revokeStaffSession();
    if (!result.ok) {
      console.warn(result.message);
    }
  }, [authSession, setActiveStaffId, setActiveTab, setAuditLog, setAuthSession, setSyncAccessKey]);

  const handleAddStaff = async (newStaffMember) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'manage staff');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const nextStaffSection = inferStaffSection(newStaffMember.staffSection || newStaffMember.role);
    const isManagerAccount = nextStaffSection === 'management' || inferRoleKey(newStaffMember.role) === 'manager' || inferRoleKey(newStaffMember.role) === 'owner';
    const chosenStaffPin = String(newStaffMember.staffPin || '').trim();

    if (!isManagerAccount && !/^\d{5}$/.test(chosenStaffPin)) {
      return { ok: false, message: 'Enter a 5 digit staff PIN.' };
    }

    if (!isManagerAccount) {
      for (const member of staffList.filter((staffMember) => !staffMember.removed && staffMember.id !== createStaffMemberId(newStaffMember.name))) {
        const existingStaffCode = sanitizePinRecord(member.staffCode);

        if (existingStaffCode && await verifyPin(chosenStaffPin, existingStaffCode)) {
          return { ok: false, message: 'That staff PIN is already in use. Choose another 5 digit PIN.' };
        }
      }
    }

    const generatedStaffCode = isManagerAccount ? '' : chosenStaffPin;
    const staffCodeRecord = generatedStaffCode ? await createPinRecord(generatedStaffCode) : null;
    const managerPinRecord = isManagerAccount ? await createPinRecord(newStaffMember.managerPin) : null;
    const nextStaffMember = {
      ...newStaffMember,
      id: createStaffMemberId(newStaffMember.name),
      staffSection: nextStaffSection,
      staffCode: staffCodeRecord,
      managerPin: managerPinRecord,
      removed: false,
      removedAt: '',
      isCsvSeed: false,
    };

    if (!isManagerAccount) {
      const accountResult = await saveStaffAccessAccount({
        ...nextStaffMember,
        roleKey: inferRoleKey(nextStaffMember.role),
      });
      if (!accountResult.ok) {
        return { ok: false, message: accountResult.message };
      }
    } else {
      try {
        await saveManagerAccount(nextStaffMember);
      } catch (error) {
        return { ok: false, message: error?.message || 'Could not save the manager account.' };
      }
    }

    setCustomStaffList(prev => {
      const existingIndex = prev.findIndex((member) => member.id === nextStaffMember.id);

      if (existingIndex === -1) {
        return [...prev, nextStaffMember];
      }

      return prev.map((member, index) => (
        index === existingIndex ? nextStaffMember : member
      ));
    });

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Staff added',
        user: activeStaffMember?.name || 'System',
        relatedItem: nextStaffMember.name,
        afterValue: {
          staffId: nextStaffMember.id,
          role: nextStaffMember.role,
          customStaffPinSet: Boolean(staffCodeRecord),
          managerAccountCreated: Boolean(managerPinRecord),
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      staffName: nextStaffMember.name,
      generatedStaffCode,
      message: isManagerAccount
        ? `Manager account added for ${nextStaffMember.name}.`
        : `Staff member added. PIN set for ${nextStaffMember.name}.`,
    };
  };

  const handleDeleteStaff = async (staffId) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'remove staff');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const staffMember = staffList.find((member) => member.id === staffId);
    const baseStaffMember = baseStaffList.find((member) => member.id === staffId);

    if (!staffMember) {
      return;
    }

    const isManagerAccount = staffMember.staffSection === 'management'
      || inferRoleKey(staffMember.role) === 'manager'
      || inferRoleKey(staffMember.role) === 'owner';
    const removedStaffMember = {
      ...staffMember,
      removed: true,
      active: false,
      removedAt: new Date().toISOString(),
    };

    if (!isManagerAccount) {
      const accountResult = await saveStaffAccessAccount(removedStaffMember);
      if (!accountResult.ok) {
        return { ok: false, message: accountResult.message };
      }
    } else {
      try {
        await saveManagerAccount(removedStaffMember);
      } catch (error) {
        return { ok: false, message: error?.message || 'Could not archive the manager account.' };
      }
    }

    if (baseStaffMember) {
      setCustomStaffList(prevStaffList => {
        const removedStaffMember = {
          ...staffMember,
          removed: true,
          removedAt: new Date().toISOString(),
          isCsvSeed: false,
        };
        const existingIndex = prevStaffList.findIndex((member) => member.id === staffId);

        if (existingIndex === -1) {
          return [...prevStaffList, removedStaffMember];
        }

        return prevStaffList.map((member, index) => (
          index === existingIndex ? { ...member, ...removedStaffMember } : member
        ));
      });
    } else {
      setCustomStaffList(prevStaffList => prevStaffList.filter((member) => member.id !== staffId));
    }

    if (activeStaffId === staffId) {
      setActiveStaffId('');
    }

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Staff removed',
        user: activeStaffMember?.name || 'System',
        relatedItem: staffMember.name,
        beforeValue: {
          staffId,
          role: staffMember.role,
          staffSection: staffMember.staffSection,
          wasCsvSeed: Boolean(baseStaffMember),
        },
      }),
      ...prevLog,
    ].slice(0, 500));
  };

  const handleResetStaffCode = async (staffId) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'reset staff PINs');
    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const staffMember = staffList.find((member) => member.id === staffId);

    if (!staffMember) {
      return { ok: false, message: 'Staff member not found.' };
    }

    const chosenStaffPin = String(window.prompt(`Enter a new 5 digit PIN for ${staffMember.name}.`, '') || '').trim();

    if (!chosenStaffPin) {
      return { ok: false, message: 'PIN reset cancelled.' };
    }

    if (!/^\d{5}$/.test(chosenStaffPin)) {
      return { ok: false, message: 'Enter a 5 digit staff PIN.' };
    }

    for (const member of staffList.filter((existingMember) => !existingMember.removed && existingMember.id !== staffId)) {
      const existingStaffCode = sanitizePinRecord(member.staffCode);

      if (existingStaffCode && await verifyPin(chosenStaffPin, existingStaffCode)) {
        return { ok: false, message: 'That staff PIN is already in use. Choose another 5 digit PIN.' };
      }
    }

    const generatedStaffCode = chosenStaffPin;
    const staffCodeRecord = await createPinRecord(chosenStaffPin);
    const accountResult = await saveStaffAccessAccount({
      ...staffMember,
      staffCode: staffCodeRecord,
      roleKey: inferRoleKey(staffMember.role),
    });
    if (!accountResult.ok) {
      return { ok: false, message: accountResult.message };
    }

    setCustomStaffList(prevStaffList => {
      const existingIndex = prevStaffList.findIndex((member) => member.id === staffId);
      const nextMember = {
        ...staffMember,
        staffCode: staffCodeRecord,
        isCsvSeed: false,
      };

      if (existingIndex === -1) {
        return [...prevStaffList, nextMember];
      }

      return prevStaffList.map((member, index) => (
        index === existingIndex ? { ...member, ...nextMember } : member
      ));
    });

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Staff PIN reset',
        user: activeStaffMember?.name || 'System',
        relatedItem: staffMember.name,
        afterValue: { staffId, customStaffPinSet: true },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      staffName: staffMember.name,
      generatedStaffCode,
      message: `New staff PIN set for ${staffMember.name}.`,
    };
  };

  return {
    handleAddStaff,
    handleDeleteStaff,
    handleInitialManagerSetup,
    handleLogin,
    handleLogout,
    handlePrepareSetupManagerAccess,
    handleRecoverManagerAccess,
    handleResetStaffCode,
    handleSavePinSettings,
  };
}
