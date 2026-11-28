const service = require('./progress-analytics.service');

const getAnalytics = async (req, res) => {
    try {
        return res.json({ success: true, data: await service.buildAnalytics(req.user.userId) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const getPlan = async (req, res) => {
    try {
        return res.json({ success: true, data: await service.getPlan(req.user.userId) });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const savePlan = async (req, res) => {
    try {
        const data = await service.saveGoalAndGeneratePlan(req.user.userId, req.body);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 400).json({ success: false, message: error.message });
    }
};

const completeTask = async (req, res) => {
    try {
        const data = await service.completePlanTask(req.user.userId, req.params.taskId);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

module.exports = { getAnalytics, getPlan, savePlan, completeTask };
