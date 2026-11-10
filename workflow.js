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
  returned: 'הוחזרה לתיקון',
  approved: 'אושרה',
  rejected: 'נדחתה',
  closed: 'סגורה',
};
const TRACKS = { regular: 'מסלול רגיל', fast: 'מסלול מזורז' };
const TRACK_STATUS = { none: '—', pending: 'ממתין לאישור מסלול', approved: 'מסלול אושר', rejected: 'מסלול נדחה' };

// מעבר -> ההרשאה הנדרשת. 'applicant' = המגיש בעצמו.
const TRANSITIONS = {
  draft: { submitted: 'applicant' },
  submitted: { review: 'requests.change_status', returned: 'requests.change_status', rejected: 'requests.change_status' },
  review: { coordination: 'requests.change_status', returned: 'requests.change_status', rejected: 'requests.change_status', approved: 'requests.final_approve' },
  coordination: { review: 'requests.change_status', returned: 'requests.change_status', rejected: 'requests.change_status', approved: 'requests.final_approve' },
  returned: { submitted: 'applicant' },
  approved: { closed: 'requests.change_status' },
  rejected: { closed: 'requests.change_status' },
  closed: {},
};
const OPEN_STATUSES = ['submitted', 'review', 'coordination', 'returned'];

module.exports = { TYPES, STATUSES, TRACKS, TRACK_STATUS, TRANSITIONS, OPEN_STATUSES };
