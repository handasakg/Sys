'use strict';
// הגדרות תהליך התיאום ההנדסי: סוגי בקשות, סטטוסים ומעברים מותרים.
const TYPES = {
  planning: 'תיאום תכנון',
  execution: 'אישור לביצוע עבודה',
  completion: 'אישור גמר עבודה',
  licensing: 'רישוי',
  infra: 'תיאום תשתיות',
};
const STATUSES = {
  draft: 'טיוטה',
  submitted: 'הוגשה',
  review: 'בבדיקה',
  coordination: 'בתיאום גורמים',
  pending_admin: 'ממתינה לאישור מנהל המערכת',
  returned: 'הוחזרה לתיקון',
  approved: 'אושרה',
  rejected: 'נדחתה',
  closed: 'סגורה',
};
const TRACKS = { regular: 'מסלול רגיל', fast: 'מסלול מזורז' };
const TRACK_STATUS = { none: '—', pending: 'ממתין לאישור מסלול', approved: 'מסלול אושר', rejected: 'מסלול נדחה' };

// מעבר -> ההרשאה הנדרשת. 'applicant' = המגיש בעצמו. 'sysadmin' = מנהל המערכת בלבד (תפקיד המערכת).
// כשכל גורמי התשתית מאשרים, הבקשה עוברת אוטומטית ל"ממתינה לאישור מנהל המערכת". רק מנהל המערכת מאשר וסוגר.
const TRANSITIONS = {
  draft: { submitted: 'applicant' },
  submitted: { review: 'requests.change_status', returned: 'requests.change_status', rejected: 'requests.change_status' },
  review: { coordination: 'requests.change_status', pending_admin: 'requests.change_status', returned: 'requests.change_status', rejected: 'requests.change_status' },
  coordination: { review: 'requests.change_status', pending_admin: 'requests.change_status', returned: 'requests.change_status', rejected: 'requests.change_status' },
  pending_admin: { approved: 'sysadmin', returned: 'sysadmin', rejected: 'sysadmin', coordination: 'sysadmin' },
  returned: { submitted: 'applicant' },
  approved: { closed: 'sysadmin' },
  rejected: { closed: 'sysadmin' },
  closed: {},
};
const OPEN_STATUSES = ['submitted', 'review', 'coordination', 'pending_admin', 'returned'];

module.exports = { TYPES, STATUSES, TRACKS, TRACK_STATUS, TRANSITIONS, OPEN_STATUSES };
