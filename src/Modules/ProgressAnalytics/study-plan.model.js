const mongoose = require('mongoose');
const { getDB_LMS } = require('../../config/db_Account');

const taskSchema = new mongoose.Schema({
    Key: { type: String, required: true },
    Type: { type: String, enum: ['practice_skill', 'complete_lesson', 'baseline'], required: true },
    Title: { type: String, required: true },
    Reason: { type: String, required: true },
    Skill: { type: String, default: null },
    ResourceID: { type: mongoose.Schema.Types.ObjectId, default: null },
    Status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
    CompletedAt: { type: Date, default: null }
});

const studyPlanSchema = new mongoose.Schema({
    UserID: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
    Goal: {
        TargetBand: { type: Number, required: true, min: 0, max: 9 },
        TargetDate: { type: Date, required: true },
        WeeklyStudyDays: { type: Number, required: true, min: 1, max: 7 },
        FocusSkills: [{ type: String, enum: ['Reading', 'Listening', 'Writing', 'Speaking'] }]
    },
    Tasks: [taskSchema]
}, { timestamps: true });

module.exports = () => {
    const db = getDB_LMS();
    return db.models.StudyPlan || db.model('StudyPlan', studyPlanSchema);
};
