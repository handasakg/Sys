'use strict';
// קטלוג ההרשאות של המערכת. כל פעולה בשרת נבדקת מול הרשימה הזו.
const PERMISSIONS = [
  // בקשות תיאום
  { key: 'requests.view_own', group: 'בקשות תיאום', label: 'צפייה בבקשות שלי / שהוקצו אליי' },
  { key: 'requests.view_all', group: 'בקשות תיאום', label: 'צפייה בכל הבקשות' },
  { key: 'requests.create', group: 'בקשות תיאום', label: 'הגשת בקשה חדשה' },
  { key: 'requests.edit_own', group: 'בקשות תיאום', label: 'עריכת בקשות שלי (לפני אישור)' },
  { key: 'requests.edit_all', group: 'בקשות תיאום', label: 'עריכת כל בקשה' },
  { key: 'requests.delete', group: 'בקשות תיאום', label: 'מחיקת בקשות' },
  { key: 'requests.assign', group: 'בקשות תיאום', label: 'הקצאת בקשה לגורם מטפל' },
  { key: 'requests.change_status', group: 'בקשות תיאום', label: 'קידום סטטוס בקשה' },
  { key: 'requests.approve_track', group: 'בקשות תיאום', label: 'אישור מסלול (רגיל / מזורז)' },
  { key: 'requests.final_approve', group: 'בקשות תיאום', label: 'מתן אישור סופי (תכנון / ביצוע / גמר)' },
  { key: 'approvals.decide', group: 'בקשות תיאום', label: 'מתן חוות דעת גורם תשתית' },
  { key: 'requests.mapping', group: 'בקשות תיאום', label: 'אחראי מיפוי בקשות: קבלת בקשות חדשות מהציבור, הזנת גורמים, צפייה בכל המסמכים כולל טופס משטרה' },
  // קבצים
  { key: 'files.upload', group: 'מסמכים וקבצים', label: 'העלאת קבצים' },
  { key: 'files.download', group: 'מסמכים וקבצים', label: 'הורדת קבצים' },
  { key: 'files.delete_own', group: 'מסמכים וקבצים', label: 'מחיקת קבצים שהעליתי' },
  { key: 'files.delete_all', group: 'מסמכים וקבצים', label: 'מחיקת כל קובץ' },
  // פרויקטים, משימות, תקציב
  { key: 'projects.view', group: 'פרויקטים ומשימות', label: 'צפייה בפרויקטים' },
  { key: 'projects.manage', group: 'פרויקטים ומשימות', label: 'יצירה ועריכה של פרויקטים' },
  { key: 'tasks.view', group: 'פרויקטים ומשימות', label: 'צפייה במשימות' },
  { key: 'tasks.manage', group: 'פרויקטים ומשימות', label: 'יצירה, עריכה ומחיקה של משימות' },
  { key: 'budget.view', group: 'תקציב', label: 'צפייה בתקציב' },
  { key: 'budget.manage', group: 'תקציב', label: 'עריכת תקציב והוצאות' },
  // ניהול
  { key: 'admin.users', group: 'ניהול מערכת', label: 'ניהול משתמשים' },
  { key: 'admin.roles', group: 'ניהול מערכת', label: 'ניהול תפקידים והרשאות' },
  { key: 'admin.settings', group: 'ניהול מערכת', label: 'הגדרות מערכת (קבצים, מסלולים, גורמי תשתית)' },
  { key: 'admin.audit', group: 'ניהול מערכת', label: 'צפייה ביומן פעילות ואבטחה' },
  { key: 'admin.backup', group: 'ניהול מערכת', label: 'ניהול גיבויים' },
];

const KEYS = new Set(PERMISSIONS.map(p => p.key));

const DEFAULT_ROLES = [
  { name: 'מנהל מערכת', system: 1, perms: PERMISSIONS.map(p => p.key) },
  { name: 'מהנדס / מאשר', system: 0, perms: ['requests.view_all', 'requests.create', 'requests.edit_all', 'requests.assign', 'requests.change_status', 'requests.approve_track', 'requests.final_approve', 'approvals.decide', 'files.upload', 'files.download', 'files.delete_own', 'projects.view', 'projects.manage', 'tasks.view', 'tasks.manage', 'budget.view', 'budget.manage'] },
  { name: 'רכז תיאום', system: 0, perms: ['requests.view_all', 'requests.create', 'requests.edit_all', 'requests.assign', 'requests.change_status', 'files.upload', 'files.download', 'files.delete_own', 'projects.view', 'tasks.view', 'tasks.manage', 'budget.view'] },
  { name: 'גורם תשתית', system: 0, perms: ['requests.view_own', 'approvals.decide', 'files.upload', 'files.download', 'files.delete_own', 'tasks.view'] },
  { name: 'מבקש / יזם', system: 0, perms: ['requests.view_own', 'requests.create', 'requests.edit_own', 'files.upload', 'files.download', 'files.delete_own'] },
  { name: 'תושב/ת', system: 0, perms: ['requests.view_own', 'requests.create', 'files.upload', 'files.download', 'files.delete_own'] },
  { name: 'יזם', system: 0, perms: ['requests.view_own', 'requests.create', 'requests.edit_own', 'files.upload', 'files.download', 'files.delete_own'] },
];

module.exports = { PERMISSIONS, KEYS, DEFAULT_ROLES };
