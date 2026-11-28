const service = require('./mistake-notebook.service');

const respond = action => async (req, res) => {
    try {
        const data = await action(req);
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : 'Mistake notebook request failed'
        });
    }
};

module.exports = {
    sources: respond(req => service.listImportSources(req.user.userId)),
    importSubmission: respond(req => service.importSubmission(req.params.submissionId, req.user.userId)),
    list: respond(req => service.listMistakes(req.user.userId, req.query)),
    update: respond(req => service.updateMistake(req.params.id, req.user.userId, req.body)),
    review: respond(req => service.recordReview(req.params.id, req.user.userId, req.body)),
    remove: respond(req => service.deleteMistake(req.params.id, req.user.userId))
};
