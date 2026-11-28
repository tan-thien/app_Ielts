const getSubmissionModel = require('../LMS/Submission/submission.model');
const getAssignmentModel = require('../LMS/Assignment/Assignment.model');
const getOrderModel = require('../LMS/Order/Order.model');
const getCourseModel = require('../LMS/Course/Course.model');
const getLessonModel = require('../LMS/lesson/lesson.model');
const getLessonProgressModel = require('../LMS/LessonProgress/lesson-progress.model');
const getStudyActivityModel = require('../LMS/LessonProgress/study-activity.model');
const getStudyPlanModel = require('./study-plan.model');

const SKILLS = ['Reading', 'Listening', 'Writing', 'Speaking'];
const isValidBand = value => {
    if (value === null || value === undefined || value === '') return false;
    const band = Number(value);
    return Number.isFinite(band) && band >= 0 && band <= 9 && Number.isInteger(band * 2);
};
const mean = values => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;
const dateKey = value => {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? null
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
};
const todayInVietnam = (date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);

const getEstimatedBand = submission => {
    if (
        !submission ||
        submission.Status !== 'Graded' ||
        !['Writing', 'Speaking'].includes(submission.PracticeType) ||
        typeof submission.AIRequestID !== 'string' ||
        !submission.AIRequestID
    ) return null;
    const result = submission.Answers?.find(answer => answer?.AIReview)?.AIReview;
    const rawBand = result?.estimatedOverallBand;
    return isValidBand(rawBand) ? Number(rawBand) : null;
};

const getObjectiveAssignmentPercent = (submission, assignment) => {
    if (!submission || !assignment || submission.Status !== 'Graded') return null;
    const questions = assignment.Questions || [];
    if (!questions.length || questions.some(question => ['Essay', 'Speaking'].includes(question.Type))) return null;
    if (questions.some(question => question.Score === null || question.Score === undefined || question.Score === '')) return null;
    const questionScores = questions.map(question => Number(question.Score));
    if (questionScores.some(score => !Number.isFinite(score) || score < 0)) return null;
    const possible = questionScores.reduce((sum, score) => sum + score, 0);
    const answers = submission.Answers || [];
    if (possible <= 0 || answers.length !== questions.length ||
        answers.some(answer => answer.Score === null || answer.Score === undefined || answer.Score === '' || !Number.isFinite(Number(answer.Score)))) return null;

    const earned = answers.reduce((sum, answer) => sum + Number(answer.Score), 0);
    if (submission.TotalScore === null || submission.TotalScore === undefined || submission.TotalScore === '') return null;
    const recordedTotal = Number(submission.TotalScore);
    if (!Number.isFinite(recordedTotal) || Math.abs(earned - recordedTotal) > 0.01 ||
        earned < 0 || earned > possible) return null;
    return Number(((earned / possible) * 100).toFixed(1));
};

const calculateStreak = (studyDates, today = todayInVietnam()) => {
    const dates = [...new Set(studyDates.filter(value => dateKey(value) === value))].sort().reverse();
    if (!dates.length) return { days: 0, lastStudyDate: null };
    const todayDate = new Date(`${today}T00:00:00Z`);
    const yesterday = new Date(todayDate.getTime() - 86400000).toISOString().slice(0, 10);
    if (dates[0] !== today && dates[0] !== yesterday) return { days: 0, lastStudyDate: dates[0] };

    let days = 1;
    let expected = new Date(`${dates[0]}T00:00:00Z`);
    for (let index = 1; index < dates.length; index += 1) {
        expected = new Date(expected.getTime() - 86400000);
        if (dates[index] !== expected.toISOString().slice(0, 10)) break;
        days += 1;
    }
    return { days, lastStudyDate: dates[0] };
};

const createTimeline = ({ aiRecords, assignmentRecords, lessonProgress, activities }) => {
    const days = new Map();
    const getDay = date => {
        if (!date) return null;
        if (!days.has(date)) {
            days.set(date, {
                date,
                studyActivity: false,
                completedLessons: 0,
                aiPractices: 0,
                aiEstimatedBands: [],
                objectiveAssignments: 0,
                objectiveAssignmentPercentages: []
            });
        }
        return days.get(date);
    };

    activities.forEach(activity => {
        const day = getDay(dateKey(activity.StudyDate));
        if (day) day.studyActivity = true;
    });
    lessonProgress.forEach(progress => {
        const day = getDay(dateKey(progress.CompletedAt || progress.createdAt));
        if (day) day.completedLessons += 1;
    });
    aiRecords.forEach(({ submission, band }) => {
        const day = getDay(dateKey(submission.SubmitTime || submission.createdAt));
        if (day) {
            day.aiPractices += 1;
            day.aiEstimatedBands.push(band);
        }
    });
    assignmentRecords.forEach(({ submission, percent }) => {
        const day = getDay(dateKey(submission.SubmitTime || submission.createdAt));
        if (day) {
            day.objectiveAssignments += 1;
            day.objectiveAssignmentPercentages.push(percent);
        }
    });
    return [...days.values()]
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(-90)
        .map(day => ({
            ...day,
            averageAiEstimatedBand: mean(day.aiEstimatedBands),
            averageObjectiveAssignmentPercent: mean(day.objectiveAssignmentPercentages),
            aiEstimatedBands: undefined,
            objectiveAssignmentPercentages: undefined
        }));
};

const buildAnalytics = async userId => {
    const Submission = getSubmissionModel();
    const Assignment = getAssignmentModel();
    const Order = getOrderModel();
    const Course = getCourseModel();
    const Lesson = getLessonModel();
    const LessonProgress = getLessonProgressModel();
    const StudyActivity = getStudyActivityModel();

    const submissions = await Submission.find({ UserID: userId }).select(
        'AssignmentID PracticeType AIRequestID Status TotalScore Duration SubmitTime createdAt Answers.AIReview.estimatedOverallBand Answers.Score'
    ).lean();
    const completedOrders = await Order.find({ AccountID: userId, Status: 'Paid' }).select('CourseID').lean();
    const courseIds = [...new Set(completedOrders.map(order => String(order.CourseID)))];
    const [courses, lessons, lessonProgress, activities] = await Promise.all([
        courseIds.length ? Course.find({ _id: { $in: courseIds }, IsDeleted: false }).select('_id Name').lean() : [],
        courseIds.length ? Lesson.find({ CourseID: { $in: courseIds }, IsDeleted: false, Status: 'Active' }).select('_id CourseID Name').lean() : [],
        courseIds.length ? LessonProgress.find({ UserID: userId, CourseID: { $in: courseIds } }).select('CourseID LessonID CompletedAt createdAt').lean() : [],
        StudyActivity.find({ UserID: userId }).select('StudyDate CourseID').lean()
    ]);

    const assignmentsById = new Map();
    const assignedSubmissionIds = [...new Set(
        submissions.filter(submission => submission.AssignmentID).map(submission => String(submission.AssignmentID))
    )];
    if (assignedSubmissionIds.length) {
        const assignments = await Assignment.find({ _id: { $in: assignedSubmissionIds } })
            .select('_id Title Skill Questions.Type Questions.Score').lean();
        assignments.forEach(assignment => assignmentsById.set(String(assignment._id), assignment));
    }

    const aiRecords = submissions.flatMap(submission => {
        const band = getEstimatedBand(submission);
        return band === null ? [] : [{ submission, band, skill: submission.PracticeType }];
    });
    const assignmentRecords = submissions.flatMap(submission => {
        if (!submission.AssignmentID) return [];
        const assignment = assignmentsById.get(String(submission.AssignmentID));
        const percent = getObjectiveAssignmentPercent(submission, assignment);
        return percent === null ? [] : [{ submission, assignment, percent, skill: assignment.Skill }];
    });

    const aiBySkill = SKILLS.map(skill => {
        const values = aiRecords.filter(record => record.skill === skill).map(record => record.band);
        return { skill, count: values.length, averageEstimatedBand: mean(values) };
    });
    const assignmentBySkill = SKILLS.map(skill => {
        const values = assignmentRecords.filter(record => record.skill === skill).map(record => record.percent);
        return { skill, count: values.length, averagePercent: mean(values) };
    });
    const lessonsByCourse = new Map();
    lessons.forEach(lesson => {
        const id = String(lesson.CourseID);
        if (!lessonsByCourse.has(id)) lessonsByCourse.set(id, []);
        lessonsByCourse.get(id).push(lesson);
    });
    const validLessonIds = new Set(lessons.map(lesson => String(lesson._id)));
    const validLessonProgress = lessonProgress.filter(progress => validLessonIds.has(String(progress.LessonID)));
    const progressByCourse = new Map();
    validLessonProgress.forEach(progress => {
        const id = String(progress.CourseID);
        progressByCourse.set(id, (progressByCourse.get(id) || 0) + 1);
    });
    const courseProgress = courses.map(course => {
        const courseLessons = lessonsByCourse.get(String(course._id)) || [];
        const completedLessons = Math.min(progressByCourse.get(String(course._id)) || 0, courseLessons.length);
        return {
            courseId: String(course._id),
            name: course.Name,
            totalLessons: courseLessons.length,
            completedLessons,
            percent: courseLessons.length ? Math.round((completedLessons / courseLessons.length) * 100) : null,
            state: courseLessons.length ? 'available' : 'no_lessons'
        };
    });
    const validStudyDates = [...new Set(activities.map(activity => dateKey(activity.StudyDate)).filter(Boolean))].sort();
    const recordedDurationSeconds = submissions
        .filter(submission => submission.Status !== 'Doing' && submission.SubmitTime && Number.isFinite(Number(submission.Duration)) && Number(submission.Duration) > 0)
        .reduce((sum, submission) => sum + Number(submission.Duration), 0);
    const timeline = createTimeline({ aiRecords, assignmentRecords, lessonProgress: validLessonProgress, activities });
    const averageAiBand = mean(aiRecords.map(record => record.band));
    const averageAssignmentPercent = mean(assignmentRecords.map(record => record.percent));

    return {
        availability: {
            aiEstimatedBands: {
                state: aiRecords.length ? 'available' : 'no_data',
                message: aiRecords.length ? null : 'Chưa có điểm ước tính từ bài luyện Viết hoặc Nói bằng AI.'
            },
            objectiveAssignments: {
                state: assignmentRecords.length ? 'available' : 'no_data',
                message: assignmentRecords.length ? null : 'Chưa có kết quả bài tập khách quan nào được chấm hoàn tất.'
            },
            lessons: {
                state: courses.length ? 'available' : 'no_courses',
                message: courses.length ? null : 'Tiến độ bài học sẽ xuất hiện khi bạn có khóa học đã thanh toán.'
            },
            studyActivity: {
                state: validStudyDates.length ? 'available' : 'no_data',
                message: validStudyDates.length ? null : 'Chưa có ngày học nào được ghi nhận.'
            }
        },
        summary: {
            aiPracticeCount: aiRecords.length,
            averageAiEstimatedBand: averageAiBand,
            objectiveAssignmentCount: assignmentRecords.length,
            averageObjectiveAssignmentPercent: averageAssignmentPercent,
            completedLessonCount: validLessonProgress.length,
            recordedStudyDurationSeconds: recordedDurationSeconds
        },
        aiEstimatedBands: {
            average: averageAiBand,
            count: aiRecords.length,
            bySkill: aiBySkill
        },
        objectiveAssignments: {
            averagePercent: averageAssignmentPercent,
            count: assignmentRecords.length,
            bySkill: assignmentBySkill
        },
        streak: calculateStreak(validStudyDates),
        studyDates: validStudyDates,
        courses: courseProgress,
        timeline
    };
};

const normalizeGoalInput = input => {
    const rawTargetBand = input?.targetBand;
    const targetBand = Number(rawTargetBand);
    const weeklyStudyDays = Number(input?.weeklyStudyDays);
    const targetDate = dateKey(input?.targetDate);
    const focusSkills = [...new Set(Array.isArray(input?.focusSkills) ? input.focusSkills : [])];
    if (!isValidBand(rawTargetBand)) throw Object.assign(new Error('Band mục tiêu phải từ 0 đến 9, theo mức tăng 0,5.'), { statusCode: 400 });
    if (!targetDate) throw Object.assign(new Error('Vui lòng chọn ngày mục tiêu hợp lệ.'), { statusCode: 400 });
    if (!Number.isInteger(weeklyStudyDays) || weeklyStudyDays < 1 || weeklyStudyDays > 7) {
        throw Object.assign(new Error('Số ngày học mỗi tuần phải từ 1 đến 7.'), { statusCode: 400 });
    }
    if (focusSkills.some(skill => !SKILLS.includes(skill))) {
        throw Object.assign(new Error('Kỹ năng ưu tiên phải là Reading, Listening, Writing hoặc Speaking.'), { statusCode: 400 });
    }
    return {
        TargetBand: targetBand,
        TargetDate: new Date(`${targetDate}T12:00:00.000Z`),
        WeeklyStudyDays: weeklyStudyDays,
        FocusSkills: focusSkills
    };
};

const skillName = skill => ({
    Reading: 'Đọc',
    Listening: 'Nghe',
    Writing: 'Viết',
    Speaking: 'Nói'
})[skill] || skill;

const skillEvidence = (analytics, skill) => {
    const name = skillName(skill);
    const ai = analytics.aiEstimatedBands.bySkill.find(item => item.skill === skill);
    if (ai?.count) return `Band ${name} do AI ước tính hiện đạt trung bình ${ai.averageEstimatedBand} qua ${ai.count} lượt luyện đã hoàn thành. Đây là điểm ước tính, không phải điểm bài tập.`;
    const assignment = analytics.objectiveAssignments.bySkill.find(item => item.skill === skill);
    if (assignment?.count) return `Độ chính xác kỹ năng ${name} trong bài tập khách quan đạt trung bình ${assignment.averagePercent}% qua ${assignment.count} kết quả đã xác minh.`;
    return `Bạn đã chọn kỹ năng ${name} để ưu tiên, nhưng chưa có điểm ước tính từ AI hoặc kết quả bài tập khách quan được ghi nhận.`;
};

const generateTaskSuggestions = ({ goal, analytics, lessons }) => {
    const tasks = [];
    const goalContext = `Mục tiêu của bạn là đạt band ${goal.TargetBand} trước ngày ${dateKey(goal.TargetDate)}, với ${goal.WeeklyStudyDays} ngày học mỗi tuần.`;
    let skills = goal.FocusSkills;
    if (!skills.length) {
        const aiSkills = analytics.aiEstimatedBands.bySkill.filter(item => item.count);
        if (aiSkills.length) {
            const weakest = [...aiSkills].sort((a, b) => a.averageEstimatedBand - b.averageEstimatedBand)[0];
            skills = [weakest.skill];
        } else {
            const objectiveSkills = analytics.objectiveAssignments.bySkill.filter(item => item.count);
            if (objectiveSkills.length) {
                const weakest = [...objectiveSkills].sort((a, b) => a.averagePercent - b.averagePercent)[0];
                skills = [weakest.skill];
            }
        }
    }
    skills.forEach(skill => tasks.push({
        key: `practice:${skill}`,
        type: 'practice_skill',
        title: `Luyện tập kỹ năng ${skillName(skill)}`,
        reason: `${skillEvidence(analytics, skill)} ${goalContext}`,
        skill,
        resourceId: null
    }));

    const incompleteLessons = lessons
        .filter(lesson => !lesson.completed)
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        .slice(0, 3);
    incompleteLessons.forEach(lesson => tasks.push({
        key: `lesson:${lesson.id}`,
        type: 'complete_lesson',
        title: `Hoàn thành bài học: ${lesson.name}`,
        reason: `Đây là bài học có sẵn trong khóa học bạn đã mua và chưa được đánh dấu hoàn thành. ${goalContext}`,
        skill: null,
        resourceId: lesson.id
    }));

    if (!tasks.length) {
        const reason = analytics.availability.aiEstimatedBands.state === 'no_data' &&
            analytics.availability.objectiveAssignments.state === 'no_data' &&
            analytics.availability.lessons.state !== 'available'
            ? 'Chưa có lượt luyện AI, kết quả bài tập khách quan đã xác minh hoặc tiến độ bài học trong khóa học đã mua. Hãy hoàn thành một hoạt động học tập để bắt đầu ghi nhận tiến độ.'
            : 'Mục tiêu và dữ liệu hiện có chưa xác định được kỹ năng ưu tiên hoặc bài học chưa hoàn thành. Hãy chọn kỹ năng ưu tiên hoặc cập nhật mục tiêu để tạo nhiệm vụ cụ thể.';
        tasks.push({
            key: 'baseline:first-evidence',
            type: 'baseline',
            title: 'Ghi nhận kết quả học tập đầu tiên',
            reason: `${reason} ${goalContext}`,
            skill: null,
            resourceId: null
        });
    }
    return tasks;
};

const mapTasksToStoredShape = (suggestions, priorTasks = []) => {
    const previousTasks = new Map(priorTasks.map(task => [task.Key, task]));
    return suggestions.map(suggestion => {
        const prior = previousTasks.get(suggestion.key);
        return {
            Key: suggestion.key,
            Type: suggestion.type,
            Title: suggestion.title,
            Reason: suggestion.reason,
            Skill: suggestion.skill,
            ResourceID: suggestion.resourceId,
            ...(prior?.Status === 'Completed'
                ? { Status: 'Completed', CompletedAt: prior.CompletedAt }
                : { Status: 'Pending', CompletedAt: null })
        };
    });
};

const getPlan = async userId => getStudyPlanModel().findOne({ UserID: userId }).lean();

const saveGoalAndGeneratePlan = async (userId, input) => {
    const goal = normalizeGoalInput(input);
    const analytics = await buildAnalytics(userId);
    const courseIds = analytics.courses.map(course => course.courseId);
    const [lessons, lessonProgress, existing] = await Promise.all([
        courseIds.length
            ? getLessonModel().find({ CourseID: { $in: courseIds }, IsDeleted: false, Status: 'Active' }).select('_id Name').lean()
            : [],
        courseIds.length
            ? getLessonProgressModel().find({ UserID: userId, CourseID: { $in: courseIds } }).select('LessonID').lean()
            : [],
        getStudyPlanModel().findOne({ UserID: userId })
    ]);
    const completed = new Set(lessonProgress.map(progress => String(progress.LessonID)));
    const suggestions = generateTaskSuggestions({
        goal,
        analytics,
        lessons: lessons.map(lesson => ({
            id: String(lesson._id),
            name: lesson.Name,
            completed: completed.has(String(lesson._id))
        }))
    });
    const tasks = mapTasksToStoredShape(suggestions, existing?.Tasks || []);
    const StudyPlan = getStudyPlanModel();
    return StudyPlan.findOneAndUpdate(
        { UserID: userId },
        { $set: { Goal: goal, Tasks: tasks }, $setOnInsert: { UserID: userId } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
};

const completePlanTask = async (userId, taskId) => {
    const StudyPlan = getStudyPlanModel();
    const plan = await StudyPlan.findOne({ UserID: userId });
    if (!plan) throw Object.assign(new Error('Không tìm thấy lộ trình học.'), { statusCode: 404 });
    const task = plan.Tasks.id(taskId);
    if (!task) throw Object.assign(new Error('Không tìm thấy nhiệm vụ học tập.'), { statusCode: 404 });
    if (task.Status !== 'Completed') {
        task.Status = 'Completed';
        task.CompletedAt = new Date();
        await plan.save();
    }
    return plan.toObject();
};

module.exports = {
    buildAnalytics,
    getPlan,
    saveGoalAndGeneratePlan,
    completePlanTask,
    _test: {
        getEstimatedBand,
        getObjectiveAssignmentPercent,
        calculateStreak,
        createTimeline,
        normalizeGoalInput,
        generateTaskSuggestions,
        mapTasksToStoredShape
    }
};
