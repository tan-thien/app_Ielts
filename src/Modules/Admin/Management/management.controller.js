const managementService = require('./management.service');

const getDashboard = async (req, res) => {
    try {
        return res.json({ success: true, data: await managementService.getDashboard(req.query) });
    } catch (error) {
        console.error('Get admin management dashboard error:', error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

const getReports = async (req, res) => {
    try {
        return res.json({ success: true, data: await managementService.getReports(req.query) });
    } catch (error) {
        console.error('Get admin reports error:', error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

const setAccountRole = async (req, res) => {
    try {
        const account = await managementService.setAccountRole(req.params.accountId, req.body.role);
        return res.json({ success: true, data: account });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

const setCourseTeachers = async (req, res) => {
    try {
        const course = await managementService.setCourseTeachers(
            req.params.courseId,
            req.body.teacherIds
        );
        return res.json({ success: true, data: course });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = { getDashboard, getReports, setAccountRole, setCourseTeachers };
