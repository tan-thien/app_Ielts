const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const assignmentSchema = new mongoose.Schema({
    Title: { type: String, required: true },
    Description: { type: String, default: "" },
    Skill: { type: String, enum: ["Reading", "Listening", "Writing", "Speaking"], required: true },
    AssignmentType: { type: String, enum: ["Practice", "Quiz", "Exam", "Homework"], default: "Practice" },
    LessonID: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson", default: null },
    CourseID: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },
    UserCreate: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    Duration: { type: Number, default: 0 },
    TotalScore: { type: Number, default: 9 },
    AttemptLimit: { type: Number, default: 0 },
    StartDate: { type: Date },
    EndDate: { type: Date },
    Questions: [{
        Order: { type: Number, required: true },
        Type: { type: String, enum: ["MultipleChoice", "Checkbox", "TrueFalse", "FillBlank", "Matching", "Ordering", "Essay", "Speaking"], required: true },
        Title: { type: String, default: "" },
        Question: { type: String, required: true },
        Resources: [{
            Type: { type: String, enum: ["Text", "Image", "Audio", "Video", "PDF"] },
            Url: { type: String, default: "" },
            Content: { type: String, default: "" }
        }],
        Choices: [{
            Key: { type: String },
            Content: { type: String }
        }],
        CorrectAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
        Explanation: { type: String, default: "" },
        Score: { type: Number, default: 1 }
    }],
    IsOpen: { type: Boolean, default: false },
    IsDeleted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = () => { return getDB_LMS().model('Assignment', assignmentSchema); };