const service = require("./lesson_detail.service");

const createDetail = async (req, res) => {

    try {

        const detail = await service.createDetail(req.body);

        res.json({
            success: true,
            data: detail
        });

    } catch (err) {

        res.status(400).json({
            success: false,
            message: err.message
        });

    }

};

const getDetailById = async (req, res) => {

    try {

        const detail = await service.getDetailById(req.params.id);

        res.json({
            success: true,
            data: detail
        });

    } catch (err) {

        res.status(404).json({
            success: false,
            message: err.message
        });

    }

};

const getByLesson = async (req, res) => {

    try {

        const details = await service.getByLesson(req.params.lessonId);

        res.json({
            success: true,
            data: details
        });

    } catch (err) {

        res.status(400).json({
            success: false,
            message: err.message
        });

    }

};

const updateDetail = async (req, res) => {

    try {

        const detail = await service.updateDetail(
            req.params.id,
            req.body
        );

        res.json({
            success: true,
            data: detail
        });

    } catch (err) {

        res.status(400).json({
            success: false,
            message: err.message
        });

    }

};

const deleteDetail = async (req, res) => {

    try {

        await service.deleteDetail(req.params.id);

        res.json({
            success: true,
            message: "Delete successfully"
        });

    } catch (err) {

        res.status(400).json({
            success: false,
            message: err.message
        });

    }

};

module.exports = {
    createDetail,
    getDetailById,
    getByLesson,
    updateDetail,
    deleteDetail
};