const { get } = require('mongoose');
const getCourseModel = require('./Course.model');
const getUserModel = require('../../auth/Account.model');
const getUserDetailModel = require('../../auth/Account_Detail.model');
const { authorize } = require('../../../middlewares/authorize.middleware');

const createCourse = async (data) => {
    const Course = getCourseModel();
    const requiredFields = [
        'Name',
        'Description',
        'Time',
        'Thumbnail'
    ];
    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null) {
            throw new Error(`${field} is required`);
        }
    }
    const course = await Course.create({
        Name: data.Name,
        Description: data.Description,
        Time: data.Time,
        UserCreate: data.UserCreate,
        Fee: data.Fee || 0,
        Thumbnail: data.Thumbnail,
        Status: data.Status ?? false,
        IsOpen: data.IsOpen ?? false,
        IsDeleted: data.IsDeleted ?? false
    });

    return course;
};

const updateCourse = async (id, data) => {
    const Course = getCourseModel();

    const course = await Course.findByIdAndUpdate(
        id,
        {
            Name: data.Name,
            Description: data.Description,
            Time: data.Time,
            UserCreate: data.UserCreate,
            Fee: data.Fee,
            Thumbnail: data.Thumbnail,
            Status: data.Status,
            IsOpen: data.IsOpen,
            IsDeleted: data.IsDeleted
        },
        {
            new: true
        }
    );
    if (!course) {
        throw new Error('Course not found');
    }
    return course;
};
const getAllCourse = async () => {

    const Course = getCourseModel();
    const User = getUserModel();
    const UserDetail = getUserDetailModel();
    
    const courses = await Course.find({ IsDeleted: false }).populate({path: 'UserCreate', model: User, select: 'Email'}).sort({createdAt: -1});

    return courses;
};
const getCourseById = async (id) => {

    const Course = getCourseModel();
    const User = getUserModel();
    const course = await Course.findOne({ _id: id, IsDeleted: false }).populate({path: 'UserCreate', model: User, select: 'Email Role'});
    if (!course) {
        throw new Error('Course not found');
    }
    return course;
};


const deleteCourse = async (id) => {
    const Course = getCourseModel();
    const course = await Course.findByIdAndUpdate( id, { IsDeleted: true }, { new: true });
    if (!course) {
        throw new Error('Course not found');
    }
    return course;
};

module.exports = { createCourse, updateCourse, getAllCourse, getCourseById, deleteCourse };