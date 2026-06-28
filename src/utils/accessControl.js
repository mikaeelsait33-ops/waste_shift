const ROLE_PATTERNS = [
  { key: 'owner', label: 'Owner', pattern: /\b(owner|director|admin)\b/i },
  { key: 'manager', label: 'Manager', pattern: /\b(manager|management|supervisor|shift lead)\b/i },
  { key: 'chef', label: 'Chef', pattern: /\b(chef|kitchen|cook|prep|line|scullery|grill|pizza)\b/i },
  { key: 'barista', label: 'Barista', pattern: /\b(barista|coffee|bar)\b/i },
  { key: 'staff', label: 'Staff', pattern: /\b(waiter|waitress|server|front|foh|floor|runner|staff|team)\b/i },
];

const ROLE_LABELS = Object.fromEntries(ROLE_PATTERNS.map((role) => [role.key, role.label]));

export const inferRoleKey = (roleOrName) => {
  const value = String(roleOrName || '').trim();
  const matchedRole = ROLE_PATTERNS.find((role) => role.pattern.test(value));

  return matchedRole?.key || 'staff';
};

export const getAccessProfile = (staffMember) => {
  const hasOperator = Boolean(staffMember?.id);
  const roleKey = hasOperator ? inferRoleKey(staffMember?.role) : 'unassigned';
  const isOwner = roleKey === 'owner';
  const isManager = roleKey === 'manager';
  const isChefOrBarista = roleKey === 'chef' || roleKey === 'barista';
  const isTrustedOperator = isOwner || isManager;

  return {
    hasOperator,
    operatorName: staffMember?.name || 'No operator selected',
    roleKey,
    roleLabel: hasOperator ? ROLE_LABELS[roleKey] || 'Staff' : 'Unassigned',
    canLogWaste: hasOperator,
    canViewFinancials: isTrustedOperator,
    canDeleteEntries: isTrustedOperator,
    canExportData: isTrustedOperator,
    canManageLimits: isTrustedOperator,
    canManageStaff: isTrustedOperator,
    canManageMenu: isTrustedOperator || isChefOrBarista,
    canViewStoreRoom: hasOperator,
    canManageStoreRoom: isTrustedOperator || isChefOrBarista,
    canViewAuditLog: isTrustedOperator,
    canManagePins: isTrustedOperator,
    canManageServerSync: isTrustedOperator,
    canRestoreDatabase: isTrustedOperator,
    canClearData: isTrustedOperator,
  };
};

export const requirePermission = (profile, permissionKey, actionLabel = 'perform this action') => {
  if (profile?.[permissionKey]) {
    return { ok: true, message: '' };
  }

  if (!profile?.hasOperator) {
    return {
      ok: false,
      message: `Select an owner or manager operator before you ${actionLabel}.`,
    };
  }

  return {
    ok: false,
    message: `${profile.operatorName} does not have permission to ${actionLabel}.`,
  };
};
