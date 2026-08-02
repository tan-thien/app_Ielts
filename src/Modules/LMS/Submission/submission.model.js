const mongoose = require('mongoose');
const { getDB_LMS } = require('../../../config/db_Account');

const submissionSchema = new mongoose.Schema({
    AssignmentID: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", required: true },
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
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
        AIReview: {
            Band: { type: Number, default: 0 },
            Feedback: { type: String, default: "" }
        },
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

module.exports = () => { return getDB_LMS().model('Submission', submissionSchema); };