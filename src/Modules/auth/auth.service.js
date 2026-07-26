const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const getUserModel = require('./Account.model');
const getDetailModel = require('./Account_Detail.model');

const register = async (data) => {
  const User = getUserModel();
  const Detail = getDetailModel();

  const requiredFields = [
    'Email',
    'Password',
    'Name',
    'Gender',
    'Phone',
    'Address',
    'Birthday',
    'Avatar'
  ];

  for (let field of requiredFields) {
    if (!data[field]) {
      throw new Error(`${field} is required`);
    }
  }

  const existing = await User.findOne({ Email: data.Email });
  if (existing) {
    throw new Error('Email already exists');
  }

  const hashedPassword = await bcrypt.hash(data.Password, 10);

  const user = 
  await User.create({
    Email: data.Email,
    Password: hashedPassword,
    Role: 'user'
  });

  await Detail.create({
    AccountID: user._id,
    Name: data.Name,
    Gender: data.Gender,
    Phone: data.Phone,
    Address: data.Address,
    Birthday: data.Birthday,
    Avatar: data.Avatar
  });

  return user;
};

// login
const login = async (Email, Password) => {
  const User = getUserModel();

  const user = await User.findOne({ Email });
  if (!user) throw new Error('User not found');

  const isMatch = await bcrypt.compare(Password, user.Password);
  if (!isMatch) throw new Error('Wrong password');

  const token = jwt.sign( { userId: user._id, role: user.Role}, process.env.JWT_SECRET,{ expiresIn: '1d' });

  return { token, userId: user._id, role: user.Role, iat: user.iat, exp: user.exp };
};

const getUserById = async (userId) => {
    const User = getUserModel();
    const Detail = getDetailModel();
    const user = await User.findById(userId).select('-Password');
    if (!user) {
        throw new Error("User not found");
    }
    const detail = await Detail.findOne({ AccountID: user._id});

    return {user,detail};
};

module.exports = { register, login, getUserById };