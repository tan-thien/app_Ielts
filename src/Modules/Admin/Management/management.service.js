const mongoose = require('mongoose');
const getAccountModel = require('../../auth/Account.model');
const getAccountDetailModel = require('../../auth/Account_Detail.model');
const getCourseModel = require('../../LMS/Course/Course.model');
const getOrderModel = require('../../LMS/Order/Order.model');
const getLessonModel = require('../../LMS/lesson/lesson.model');
const getAssignmentModel = require('../../LMS/Assignment/Assignment.model');
const getSubmissionModel = require('../../LMS/Submission/submission.model');
const getLessonProgressModel = require('../../LMS/LessonProgress/lesson-progress.model');

const PAGE_SIZE = 50;
const idOf = (value) => (value?._id || value)?.toString();

const parsePage = (value) => {
    const page = Number.parseInt(value, 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildAccountFilter = async (Account, Detail, role, search) => {
    const filter = role === 'all' ? { Role: { $in: ['user', 'teacher'] } } : { Role: role };
    const normalizedSearch = search.trim();
    if (!normalizedSearch) return filter;
    const regex = new RegExp(escapeRegex(normalizedSearch), 'i');
    const matchingDetails = await Detail.find({
        $or: [{ Name: regex }, { Phone: regex }]
    }).select('AccountID').lean();
    return {
        ...filter,
        $or: [
            { Email: regex },
            { _id: { $in: matchingDetails.map((detail) => detail.AccountID) } }
        ]
    };
};

const pagination = (page, total) => ({
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / PAGE_SIZE)
});

const getReports = async (options = {}) => {
    const Account = getAccountModel();
    const Course = getCourseModel();
    const Order = getOrderModel();
    const LessonProgress = getLessonProgressModel();
    const Submission = getSubmissionModel();
    const Assignment = getAssignmentModel();
    const requestedMonths = Number.parseInt(options.months, 10);
    const months = [6, 12, 24].includes(requestedMonths) ? requestedMonths : 12;
    const now = new Date();
    const vietnamDateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit'
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    const currentYear = Number(vietnamDateParts.year);
    const currentMonthNumber = Number(vietnamDateParts.month);
    const firstMonthDate = new Date(Date.UTC(currentYear, currentMonthNumber - months, 1));
    const firstMonth = new Date(firstMonthDate.getTime() - 7 * 60 * 60 * 1000);
    const endMonthDate = new Date(Date.UTC(currentYear, currentMonthNumber, 1));
    const endMonth = new Date(endMonthDate.getTime() - 7 * 60 * 60 * 1000);
    const firstMonthKey = `${firstMonthDate.getUTCFullYear()}-${String(firstMonthDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const dateFormat = {
        date: '$eventAt',
        format: '%Y-%m',
        timezone: 'Asia/Ho_Chi_Minh'
    };
    const monthlyGroup = {
        $dateToString: dateFormat
    };
    const monthlyMatch = (eventAt, filter = {}) => [
        { $match: filter },
        { $project: { eventAt } },
        { $match: { eventAt: { $gte: firstMonth, $lt: endMonth } } },
        { $group: { _id: monthlyGroup, count: { $sum: 1 } } }
    ];
    const accountMonthlyPipeline = [
        { $match: { Role: { $in: ['user', 'teacher'] } } },
        { $project: { Role: 1, eventAt: { $toDate: '$_id' } } },
        { $match: { eventAt: { $gte: firstMonth, $lt: endMonth } } },
        {
            $group: {
                _id: {
                    month: monthlyGroup,
                    role: '$Role'
                },
                count: { $sum: 1 }
            }
        }
    ];
    const courseMonthlyPipeline = [
        { $match: { IsDeleted: false } },
        { $project: { eventAt: { $toDate: '$_id' } } },
        { $match: { eventAt: { $gte: firstMonth, $lt: endMonth } } },
        { $group: { _id: monthlyGroup, count: { $sum: 1 } } }
    ];
    const revenueMonthlyPipeline = [
        { $match: { Status: 'Paid' } },
        {
            $project: {
                Amount: 1,
                eventAt: {
                    $ifNull: ['$PaidAt', { $ifNull: ['$updatedAt', '$createdAt'] }]
                }
            }
        },
        { $match: { eventAt: { $gte: firstMonth, $lt: endMonth } } },
        {
            $group: {
                _id: monthlyGroup,
                revenue: { $sum: '$Amount' },
                orders: { $sum: 1 }
            }
        }
    ];
    const [
        accountTotals,
        courseCount,
        assignmentCount,
        paidOrderTotals,
        accountMonthly,
        courseMonthly,
        revenueMonthly,
        lessonMonthly,
        submissionMonthly,
        popularCourseRecords,
        teacherCourseRecords,
        assignedTeacherIds
    ] = await Promise.all([
        Account.aggregate([
            { $match: { Role: { $in: ['user', 'teacher'] } } },
            { $group: { _id: '$Role', count: { $sum: 1 } } }
        ]),
        Course.countDocuments({ IsDeleted: false }),
        Assignment.countDocuments({ IsDeleted: false }),
        Order.aggregate([
            { $match: { Status: 'Paid' } },
            {
                $group: {
                    _id: null,
                    revenue: { $sum: '$Amount' },
                    orders: { $sum: 1 },
                    learners: { $addToSet: '$AccountID' }
                }
            },
            {
                $project: {
                    _id: 0,
                    revenue: 1,
                    orders: 1,
                    learners: { $size: '$learners' }
                }
            }
        ]),
        Account.aggregate(accountMonthlyPipeline),
        Course.aggregate(courseMonthlyPipeline),
        Order.aggregate(revenueMonthlyPipeline),
        LessonProgress.aggregate(monthlyMatch('$createdAt')),
        Submission.aggregate(monthlyMatch('$createdAt', { Status: { $in: ['Submitted', 'Graded'] } })),
        Order.aggregate([
            { $match: { Status: 'Paid' } },
            {
                $group: {
                    _id: { CourseID: '$CourseID', AccountID: '$AccountID' },
                    revenue: { $sum: '$Amount' }
                }
            },
            {
                $group: {
                    _id: '$_id.CourseID',
                    learners: { $sum: 1 },
                    revenue: { $sum: '$revenue' }
                }
            },
            { $sort: { learners: -1, revenue: -1 } },
            { $limit: 8 }
        ]),
        Course.aggregate([
            { $match: { IsDeleted: false, TeacherIDs: { $exists: true, $ne: [] } } },
            { $unwind: '$TeacherIDs' },
            {
                $group: {
                    _id: '$TeacherIDs',
                    courses: { $sum: 1 }
                }
            },
            { $sort: { courses: -1, _id: 1 } },
            { $limit: 8 }
        ]),
        Course.distinct('TeacherIDs', { IsDeleted: false })
    ]);

    const accountCountsByRole = new Map(accountTotals.map(({ _id, count }) => [_id, count]));
    const monthlyByKey = new Map();
    for (let index = 0; index < months; index += 1) {
        const date = new Date(Date.UTC(
            firstMonthDate.getUTCFullYear(),
            firstMonthDate.getUTCMonth() + index,
            1
        ));
        const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        monthlyByKey.set(month, {
            month,
            revenue: 0,
            paidOrders: 0,
            newStudents: 0,
            newTeachers: 0,
            newCourses: 0,
            completedLessons: 0,
            submissions: 0
        });
    }
    for (const item of accountMonthly) {
        const row = monthlyByKey.get(item._id.month);
        if (row) row[item._id.role === 'teacher' ? 'newTeachers' : 'newStudents'] = item.count;
    }
    for (const item of courseMonthly) {
        const row = monthlyByKey.get(item._id);
        if (row) row.newCourses = item.count;
    }
    for (const item of revenueMonthly) {
        const row = monthlyByKey.get(item._id);
        if (row) {
            row.revenue = item.revenue;
            row.paidOrders = item.orders;
        }
    }
    for (const item of lessonMonthly) {
        const row = monthlyByKey.get(item._id);
        if (row) row.completedLessons = item.count;
    }
    for (const item of submissionMonthly) {
        const row = monthlyByKey.get(item._id);
        if (row) row.submissions = item.count;
    }

    const teacherIds = teacherCourseRecords.map((item) => item._id);
    const [popularCourses, recentPaidOrders, teacherAccounts, teacherDetails] = await Promise.all([
        popularCourseRecords.length
            ? Course.find({ _id: { $in: popularCourseRecords.map((item) => item._id) } })
                .select('_id Name').lean()
            : [],
        Order.find({ Status: 'Paid' })
            .sort({ PaidAt: -1, createdAt: -1 })
            .limit(5)
            .select('CourseID Amount Currency PaymentMethod PaidAt createdAt')
            .lean(),
        teacherIds.length
            ? Account.find({ _id: { $in: teacherIds } }).select('_id Email').lean()
            : [],
        teacherIds.length
            ? getAccountDetailModel().find({ AccountID: { $in: teacherIds } })
                .select('AccountID Name').lean()
            : []
    ]);
    const courseById = new Map(popularCourses.map((course) => [idOf(course), course]));
    const recentCourseIds = [...new Set(recentPaidOrders.map((order) => idOf(order.CourseID)))];
    const recentCourses = recentCourseIds.length
        ? await Course.find({ _id: { $in: recentCourseIds } }).select('_id Name').lean()
        : [];
    const recentCourseById = new Map(recentCourses.map((course) => [idOf(course), course.Name]));
    const accountById = new Map(teacherAccounts.map((account) => [idOf(account), account]));
    const detailByAccountId = new Map(teacherDetails.map((detail) => [idOf(detail.AccountID), detail]));
    const paidTotals = paidOrderTotals[0] || { revenue: 0, orders: 0, learners: 0 };
    const monthly = [...monthlyByKey.values()];
    const currentMonth = monthly[monthly.length - 1];
    const totals = monthly.reduce((result, month) => ({
        revenue: result.revenue + month.revenue,
        paidOrders: result.paidOrders + month.paidOrders,
        newStudents: result.newStudents + month.newStudents,
        newTeachers: result.newTeachers + month.newTeachers,
        newCourses: result.newCourses + month.newCourses,
        completedLessons: result.completedLessons + month.completedLessons,
        submissions: result.submissions + month.submissions
    }), {
        revenue: 0,
        paidOrders: 0,
        newStudents: 0,
        newTeachers: 0,
        newCourses: 0,
        completedLessons: 0,
        submissions: 0
    });

    return {
        months,
        monthStart: firstMonthKey,
        totals: {
            students: accountCountsByRole.get('user') || 0,
            teachers: accountCountsByRole.get('teacher') || 0,
            assignedTeachers: assignedTeacherIds.length,
            courses: courseCount,
            assignments: assignmentCount,
            paidLearners: paidTotals.learners,
            paidOrders: paidTotals.orders,
            allTimeRevenue: paidTotals.revenue,
            ...totals
        },
        currentMonth,
        monthly,
        popularCourses: popularCourseRecords.map((item) => ({
            _id: idOf(item._id),
            name: courseById.get(idOf(item._id))?.Name || 'Khóa học đã bị xóa',
            learners: item.learners,
            revenue: item.revenue
        })),
        topTeachers: teacherCourseRecords.map((item) => {
            const account = accountById.get(idOf(item._id));
            return {
                _id: idOf(item._id),
                name: detailByAccountId.get(idOf(item._id))?.Name || account?.Email || 'Giảng viên',
                email: account?.Email || '',
                courses: item.courses
            };
        }),
        recentPaidOrders: recentPaidOrders.map((order) => ({
            _id: idOf(order),
            courseName: recentCourseById.get(idOf(order.CourseID)) || 'Khóa học không khả dụng',
            amount: order.Amount,
            currency: order.Currency || 'VND',
            paymentMethod: order.PaymentMethod,
            paidAt: order.PaidAt || order.createdAt
        }))
    };
};

const getDashboard = async (options = {}) => {
    const Account = getAccountModel();
    const Detail = getAccountDetailModel();
    const Course = getCourseModel();
    const Order = getOrderModel();
    const Lesson = getLessonModel();
    const Assignment = getAssignmentModel();
    const Submission = getSubmissionModel();
    const LessonProgress = getLessonProgressModel();

    const studentPage = parsePage(options.studentsPage);
    const accountPage = parsePage(options.accountsPage);
    const coursePage = parsePage(options.coursesPage);
    const studentSearch = String(options.studentsSearch || '').trim();
    const accountSearch = String(options.accountsSearch || '').trim();
    const courseSearch = String(options.coursesSearch || '').trim();
    const accountRole = ['user', 'teacher'].includes(options.accountsRole)
        ? options.accountsRole
        : 'all';
    const studentFilter = await buildAccountFilter(Account, Detail, 'user', studentSearch);
    const accountFilter = await buildAccountFilter(Account, Detail, accountRole, accountSearch);
    const courseFilter = { IsDeleted: false };
    if (courseSearch) courseFilter.Name = new RegExp(escapeRegex(courseSearch), 'i');

    const [
        students,
        studentCount,
        roleAccounts,
        roleAccountCount,
        teacherAccounts,
        courses,
        courseCount,
        stats
    ] = await Promise.all([
        Account.find(studentFilter).select('_id Email Role').sort({ _id: 1 })
            .skip((studentPage - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
        Account.countDocuments(studentFilter),
        Account.find(accountFilter).select('_id Email Role').sort({ _id: 1 })
            .skip((accountPage - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
        Account.countDocuments(accountFilter),
        Account.find({ Role: 'teacher' }).select('_id Email Role').lean(),
        Course.find(courseFilter).select('Name TeacherIDs IsOpen Status').sort({ Name: 1, _id: 1 })
            .skip((coursePage - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
        Course.countDocuments(courseFilter),
        Promise.all([
            Account.countDocuments({ Role: 'user' }),
            Account.countDocuments({ Role: 'teacher' }),
            Course.countDocuments({ IsDeleted: false }),
            Course.countDocuments({ IsDeleted: false, TeacherIDs: { $exists: true, $ne: [] } }),
            Order.countDocuments({ Status: 'Paid' }),
            Assignment.countDocuments({ IsDeleted: false })
        ])
    ]);

    const teacherIds = [...new Set(teacherAccounts.map(idOf))];
    const studentIds = students.map((student) => student._id);
    const [studentPaidOrders, teacherCourseRecords] = await Promise.all([
        studentIds.length
            ? Order.find({ Status: 'Paid', AccountID: { $in: studentIds } })
                .select('AccountID CourseID PaidAt').lean()
            : [],
        teacherIds.length
            ? Course.find({ TeacherIDs: { $in: teacherIds }, IsDeleted: false })
                .select('TeacherIDs').lean()
            : []
    ]);
    const visibleCourseIds = [
        ...new Set([
            ...courses.map(idOf),
            ...studentPaidOrders.map((order) => idOf(order.CourseID))
        ])
    ];
    const visibleCoursesFilter = { _id: { $in: visibleCourseIds } };
    const [
        details,
        allCoursesForStudents,
        lessons,
        submissions,
        progress
    ] = await Promise.all([
        Detail.find({
            AccountID: { $in: [...new Set([...teacherIds, ...roleAccounts.map(idOf), ...studentIds])] }
        }).select('AccountID Name Phone Avatar').lean(),
        visibleCourseIds.length
            ? Course.find(visibleCoursesFilter).select('Name TeacherIDs IsOpen Status').lean()
            : [],
        visibleCourseIds.length
            ? Lesson.find({
                CourseID: { $in: visibleCourseIds },
                IsDeleted: false,
                Status: 'Active'
            }).select('Name CourseID').lean()
            : [],
        studentIds.length
            ? Submission.find({ UserID: { $in: studentIds } })
                .select('AssignmentID UserID Status TotalScore BandScore SubmitTime createdAt')
                .sort({ createdAt: -1 }).lean()
            : [],
        studentIds.length
            ? LessonProgress.find({ UserID: { $in: studentIds } })
                .select('UserID CourseID LessonID CompletedAt').lean()
            : []
    ]);

    const lessonIds = lessons.map(idOf);
    const assignments = visibleCourseIds.length
        ? await Assignment.find({
            IsDeleted: false,
            $or: [
                { CourseID: { $in: visibleCourseIds } },
                ...(lessonIds.length ? [{ LessonID: { $in: lessonIds } }] : [])
            ]
        }).select('Title CourseID LessonID TotalScore').lean()
        : [];

    const detailByAccount = new Map(details.map((detail) => [idOf(detail.AccountID), detail]));
    const teachers = teacherAccounts
        .map((account) => ({
            _id: idOf(account),
            Email: account.Email,
            Name: detailByAccount.get(idOf(account))?.Name || account.Email,
            Phone: detailByAccount.get(idOf(account))?.Phone || '',
            Avatar: detailByAccount.get(idOf(account))?.Avatar || ''
        }));
    const teacherById = new Map(teachers.map((teacher) => [teacher._id, teacher]));

    const lessonsByCourse = new Map();
    const lessonCourseById = new Map();
    for (const lesson of lessons) {
        const courseId = idOf(lesson.CourseID);
        const lessonId = idOf(lesson);
        lessonCourseById.set(lessonId, courseId);
        if (!lessonsByCourse.has(courseId)) lessonsByCourse.set(courseId, []);
        lessonsByCourse.get(courseId).push(lesson);
    }

    const assignmentsByCourse = new Map();
    for (const assignment of assignments) {
        const courseId = idOf(assignment.CourseID) || lessonCourseById.get(idOf(assignment.LessonID));
        if (!courseId) continue;
        const enriched = { ...assignment, CourseID: courseId };
        if (!assignmentsByCourse.has(courseId)) assignmentsByCourse.set(courseId, []);
        assignmentsByCourse.get(courseId).push(enriched);
    }

    const latestSubmissionByStudentAssignment = new Map();
    const attemptCountByStudentAssignment = new Map();
    for (const submission of submissions) {
        const key = `${idOf(submission.UserID)}:${idOf(submission.AssignmentID)}`;
        attemptCountByStudentAssignment.set(key, (attemptCountByStudentAssignment.get(key) || 0) + 1);
        if (!latestSubmissionByStudentAssignment.has(key)) {
            latestSubmissionByStudentAssignment.set(key, submission);
        }
    }

    const progressByStudentCourse = new Map();
    for (const item of progress) {
        const key = `${idOf(item.UserID)}:${idOf(item.CourseID)}`;
        if (!progressByStudentCourse.has(key)) progressByStudentCourse.set(key, new Set());
        progressByStudentCourse.get(key).add(idOf(item.LessonID));
    }

    const courseTeacherIds = (course) =>
        (course.TeacherIDs || []).map(idOf).filter((teacherId) => teacherById.has(teacherId));

    const courseData = courses.map((course) => {
        const teacherIds = courseTeacherIds(course);
        return {
            _id: idOf(course),
            Name: course.Name,
            IsOpen: course.IsOpen,
            Status: course.Status,
            TeacherIDs: teacherIds,
            Teachers: teacherIds.map((teacherId) => teacherById.get(teacherId))
        };
    });

    const paidCoursesByStudent = new Map();
    for (const order of studentPaidOrders) {
        const studentId = idOf(order.AccountID);
        const courseId = idOf(order.CourseID);
        if (!studentId || !courseId || !allCoursesForStudents.some((course) => idOf(course) === courseId)) continue;
        if (!paidCoursesByStudent.has(studentId)) paidCoursesByStudent.set(studentId, new Set());
        paidCoursesByStudent.get(studentId).add(courseId);
    }

    const studentData = students
        .map((account) => {
            const studentId = idOf(account);
            const detail = detailByAccount.get(studentId);
            const studentCourses = [...(paidCoursesByStudent.get(studentId) || [])]
                .map((courseId) => {
                    const course = allCoursesForStudents.find((item) => idOf(item) === courseId);
                    const assignedTeacherIds = courseTeacherIds(course || {});
                    const assignedTeachers = assignedTeacherIds
                        .map((teacherId) => teacherById.get(teacherId))
                        .filter(Boolean);
                    const courseLessons = lessonsByCourse.get(courseId) || [];
                    const completedLessons = progressByStudentCourse.get(`${studentId}:${courseId}`) || new Set();
                    const courseAssignments = assignmentsByCourse.get(courseId) || [];
                    const courseAssignmentDetails = courseAssignments.map((assignment) => {
                        const assignmentId = idOf(assignment);
                        const key = `${studentId}:${assignmentId}`;
                        const submission = latestSubmissionByStudentAssignment.get(key);
                        return {
                            _id: assignmentId,
                            Title: assignment.Title,
                            Status: submission?.Status || 'Not started',
                            Score: submission
                                ? (submission.BandScore > 0 ? submission.BandScore : submission.TotalScore)
                                : null,
                            MaxScore: assignment.TotalScore,
                            Attempts: attemptCountByStudentAssignment.get(key) || 0,
                            SubmittedAt: submission?.SubmitTime || submission?.createdAt || null
                        };
                    });
                    const completeAssignmentCount = courseAssignmentDetails.filter(
                        (assignment) => assignment.Status !== 'Not started'
                    ).length;
                    return {
                        _id: courseId,
                        Name: course?.Name || 'Khóa học không khả dụng',
                        TeacherCount: assignedTeachers.length,
                        Teachers: assignedTeachers,
                        CompletedLessons: courseLessons.filter((lesson) =>
                            completedLessons.has(idOf(lesson))
                        ).length,
                        TotalLessons: courseLessons.length,
                        Lessons: courseLessons.map((lesson) => ({
                            _id: idOf(lesson),
                            Name: lesson.Name,
                            Completed: completedLessons.has(idOf(lesson))
                        })),
                        LessonProgress: courseLessons.length
                            ? Math.round(
                                (courseLessons.filter((lesson) => completedLessons.has(idOf(lesson))).length /
                                    courseLessons.length) * 100
                            )
                            : 0,
                        CompletedAssignments: completeAssignmentCount,
                        TotalAssignments: courseAssignmentDetails.length,
                        Assignments: courseAssignmentDetails
                    };
                });
            const totalLessons = studentCourses.reduce((sum, item) => sum + item.TotalLessons, 0);
            const completedLessons = studentCourses.reduce((sum, item) => sum + item.CompletedLessons, 0);
            const totalAssignments = studentCourses.reduce((sum, item) => sum + item.TotalAssignments, 0);
            const completedAssignments = studentCourses.reduce((sum, item) => sum + item.CompletedAssignments, 0);

            return {
                _id: studentId,
                Email: account.Email,
                Name: detail?.Name || account.Email,
                Phone: detail?.Phone || '',
                Avatar: detail?.Avatar || '',
                CourseCount: studentCourses.length,
                CompletedLessons: completedLessons,
                TotalLessons: totalLessons,
                LessonProgress: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
                CompletedAssignments: completedAssignments,
                TotalAssignments: totalAssignments,
                Courses: studentCourses
            };
        });

    const roleAccountData = roleAccounts.map((account) => {
        const detail = detailByAccount.get(idOf(account));
        return {
            _id: idOf(account),
            Email: account.Email,
            Role: account.Role,
            Name: detail?.Name || account.Email,
            Phone: detail?.Phone || '',
            Avatar: detail?.Avatar || ''
        };
    });
    const teacherCourseCounts = {};
    for (const course of teacherCourseRecords) {
        for (const teacherId of courseTeacherIds(course)) {
            teacherCourseCounts[teacherId] = (teacherCourseCounts[teacherId] || 0) + 1;
        }
    }

    return {
        stats: {
            studentCount: stats[0],
            teacherCount: stats[1],
            courseCount: stats[2],
            assignedCourseCount: stats[3],
            paidCourseCount: stats[4],
            assignmentCount: stats[5]
        },
        teachers,
        courses: courseData,
        students: studentData,
        roleAccounts: roleAccountData,
        teacherCourseCounts,
        pagination: {
            students: pagination(studentPage, studentCount),
            accounts: pagination(accountPage, roleAccountCount),
            courses: pagination(coursePage, courseCount)
        }
    };
};

const setAccountRole = async (accountId, role) => {
    if (!mongoose.isValidObjectId(accountId)) {
        const error = new Error('Invalid account ID');
        error.statusCode = 400;
        throw error;
    }
    if (!['user', 'teacher'].includes(role)) {
        const error = new Error('Role must be user or teacher');
        error.statusCode = 400;
        throw error;
    }
    const Account = getAccountModel();
    const account = await Account.findById(accountId);
    if (!account || !['user', 'teacher'].includes(account.Role)) {
        const error = new Error('Student or teacher account not found');
        error.statusCode = 404;
        throw error;
    }
    account.Role = role;
    await account.save();
    if (role === 'user') {
        const Course = getCourseModel();
        await Course.updateMany({ TeacherIDs: account._id }, { $pull: { TeacherIDs: account._id } });
    }
    return { _id: account._id, Email: account.Email, Role: account.Role };
};

const setCourseTeachers = async (courseId, teacherIds) => {
    if (!mongoose.isValidObjectId(courseId)) {
        const error = new Error('Invalid course ID');
        error.statusCode = 400;
        throw error;
    }
    if (!Array.isArray(teacherIds) || teacherIds.some((id) => !mongoose.isValidObjectId(id))) {
        const error = new Error('teacherIds must be an array of valid account IDs');
        error.statusCode = 400;
        throw error;
    }

    const uniqueIds = [...new Set(teacherIds.map(String))];
    const Account = getAccountModel();
    const teachers = await Account.find({ _id: { $in: uniqueIds }, Role: 'teacher' }).select('_id');
    if (teachers.length !== uniqueIds.length) {
        const error = new Error('Every assigned account must have the teacher role');
        error.statusCode = 400;
        throw error;
    }

    const Course = getCourseModel();
    const course = await Course.findOneAndUpdate(
        { _id: courseId, IsDeleted: false },
        { $set: { TeacherIDs: teachers.map((teacher) => teacher._id) } },
        { new: true }
    ).select('_id Name TeacherIDs');
    if (!course) {
        const error = new Error('Course not found');
        error.statusCode = 404;
        throw error;
    }
    return course;
};

module.exports = { getDashboard, getReports, setAccountRole, setCourseTeachers };
