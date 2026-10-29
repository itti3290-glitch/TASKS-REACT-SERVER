# ShiftUp: שרת

פרויקט גמר בקורס React. זה **השרת** (Express + PostgreSQL). האתר נמצא ב-repository נפרד:
https://github.com/itti3290-glitch/TASKS-REACT-CLIENT

**השרת החי:** https://final-react-project-serw.onrender.com
(אין לו דף בית, הוא עונה רק לכתובות `/api/...`. שרת חינמי נרדם אחרי זמן חוסר פעילות.)

## טכנולוגיות

Node.js, Express 5, PostgreSQL (Neon), JWT, bcryptjs, cors.

## הרצה מקומית

דרוש Node.js וקובץ `.env` בתיקייה הזאת (הקובץ לא נמצא ב-Git) עם שני משתנים:

```
DATABASE_URL=<כתובת החיבור למסד PostgreSQL>
JWT_SECRET=<מחרוזת סודית לחתימת הטוקנים>
```

```
npm install
npm run dev
```

השרת רץ בכתובת http://localhost:3000.

## סקריפטים

מריצים מתוך התיקייה הזאת:

- יצירת מנהל: `node --env-file=.env scripts/create-admin.js EMAIL PASSWORD`
- נתוני דוגמה (שני מטופלים, שני מתנדבים ומשימות; בטוח להרצה חוזרת): `node --env-file=.env scripts/seed-demo.js`

## נתיבי ה-API

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `PUT /api/me` (עריכת הפרופיל של עצמי)
- `GET/POST/PUT/DELETE /api/tasks`, `POST /api/tasks/:id/signup`, `POST /api/tasks/:id/replacement-request`
- `GET/POST/PUT/DELETE /api/patients`, `POST/DELETE /api/patients/:id/volunteers`
- `GET/POST/PUT/DELETE /api/users` (מנהל בלבד)
- `GET /api/requests`, `POST /api/requests/:id/accept`

## מסד הנתונים

טבלאות: `patients`, `users`, `user_patients` (קשר רבים לרבים), `tasks`, `task_signups`, `replacement_requests`.

## כלל זמנים

מתנדב לא יכול להירשם (או לקחת החלפה) למשימה שמתחילה פחות מ-30 דקות לפני או אחרי משימה אחרת שלו. משימה בלי משך נחשבת 60 דקות. הבדיקה נמצאת ב-`schedule.js`.
