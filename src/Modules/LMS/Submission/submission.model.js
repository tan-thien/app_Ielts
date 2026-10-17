const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const submissionSchema = new mongoose.Schema({
    AssignmentID: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", default: null },
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    Skill: { type: String, enum: ["Reading", "Listening", "Writing", "Speaking"], default: null },
    PracticeType: { type: String, enum: ["Writing", "Speaking"], default: null },
    TaskType: { type: String, default: null },
    Prompt: { type: String, default: "" },
    AudioMimeType: { type: String, default: "" },
    StartTime: { type: Date, default: Date.now },
    SubmitTime: { type: Date },
    Duration: { type: Number, default: 0 },
    Status: { type: String, enum: ["Doing", "Submitted", "Graded"], default: "Doing" },
    Answers: [{
        QuestionOrder: { type: Number, required: true },
        Answer: { type: mongoose.Schema.Types.Mixed },
        FileUrl: { type: String, default: "" },
        Score: { type: Number, default: 0 },
        Feedback: { type: String, default: "" },
        AIReview: { type: mongoose.Schema.Types.Mixed, default: null },
        TeacherReview: {
            TeacherID: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
            Band: { type: Number, default: 0 },
            Feedback: { type: String, default: "" }
        }
    }],
    TotalScore: { type: Number, default: 0 },
    BandScore: { type: Number, default: 0 },
    IsPassed: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.Submission || db.model('Submission', submissionSchema);
};
