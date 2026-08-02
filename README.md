# IELTS LMS Backend

Backend API for the IELTS Learning Management System (LMS), built with **Node.js**, **Express.js**, and **MongoDB**. The system provides authentication, course management, lesson management, assignments, submissions, and AI-ready APIs for IELTS learning.

---

## Technologies

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT Authentication
- bcrypt
- Multer
- dotenv
- CORS

---

## Features

### Authentication

- User Registration
- User Login
- JWT Authentication
- Role Authorization (Admin/User)
- User Profile

### Course Management

- Create Course
- Update Course
- Get Course
- Delete Course

### Lesson Management

- Create Lesson
- Update Lesson
- Lesson Details
- Get Lessons by Course

### Assignment

- Create Assignment
- Update Assignment
- Get Assignment
- Delete Assignment

### Submission

- Submit Assignment
- View Submission
- Teacher Review
- AI Review (Future)

---

## Project Structure

```
src
│
├── auth
│
├── config
│
├── middlewares
│
├── modules
│   ├── Auth
│   ├── LMS
│   │   ├── Course
│   │   ├── Lesson
│   │   ├── Assignment
│   │   └── Submission
│   └── ...
│
├── routes
│
├── utils
│
├── app.js
└── server.js
```

---

## Installation

Clone the project

```bash
git clone https://github.com/your-username/app_ielts.git
```

Move into the project

```bash
cd app_ielts
```

Install packages

```bash
npm install
```

---

## Environment Variables

Create a `.env` file in the project root.

Example

```env
PORT=3000

JWT_SECRET=your_secret_key

MONGODB_URI=your_mongodb_connection_string
```

> **Do not commit your `.env` file to GitHub.**

---

## Run Project

Development

```bash
npm run dev
```

Production

```bash
npm start
```

Server

```
http://localhost:3000
```

---

## API

Example

```
POST   /api/auth/login

POST   /api/auth/register

GET    /api/courses/get-all

POST   /api/courses/create

PUT    /api/courses/update/:id

GET    /api/lessons/course/:courseId
```

---

## Authentication

Protected APIs require a JWT token.

Example

```
Authorization: Bearer your_token
```

---

## Git Ignore

Never upload the following files:

```
.env

node_modules/

uploads/

logs/

*.log
```

---

## Future Features

- IELTS AI Writing Scoring
- IELTS AI Speaking Scoring
- Payment Integration
- Certificate Generation
- Student Progress Dashboard

---

## License

This project is for educational purposes.