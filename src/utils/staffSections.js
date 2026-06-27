export const STAFF_SECTIONS = [
  {
    key: 'kitchen',
    label: 'Kitchen Staff',
    shortLabel: 'Kitchen',
    color: '#ff6b35',
  },
  {
    key: 'barista',
    label: 'Barista',
    shortLabel: 'Barista',
    color: '#7c3aed',
  },
  {
    key: 'waiters',
    label: 'Waiters',
    shortLabel: 'Waiters',
    color: '#0a84ff',
  },
  {
    key: 'management',
    label: 'Management',
    shortLabel: 'Management',
    color: '#168a4a',
  },
];

export const DEFAULT_STAFF_SECTION = 'kitchen';

export const getStaffSectionMeta = (sectionKey) => (
  STAFF_SECTIONS.find((section) => section.key === sectionKey) || STAFF_SECTIONS[0]
);

export const inferStaffSection = (roleOrSection) => {
  const value = String(roleOrSection || '').trim().toLowerCase();

  if (STAFF_SECTIONS.some((section) => section.key === value)) {
    return value;
  }

  if (/\b(owner|manager|management|supervisor|admin|director)\b/i.test(value)) {
    return 'management';
  }

  if (/\b(barista|coffee|bar)\b/i.test(value)) {
    return 'barista';
  }

  if (/\b(waiter|waitress|server|front|foh|floor|runner)\b/i.test(value)) {
    return 'waiters';
  }

  if (/\b(chef|kitchen|cook|prep|line|scullery|grill|pizza)\b/i.test(value)) {
    return 'kitchen';
  }

  return DEFAULT_STAFF_SECTION;
};
