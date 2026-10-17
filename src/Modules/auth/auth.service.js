const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const getUserModel = require('./Account.model');
const getDetailModel = require('./Account_Detail.model');
const getLoginEventModel = require('./LoginEvent.model');

const createSession = (user) => {
  const token = jwt.sign(
    { userId: user._id, role: user.Role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return { token, userId: user._id, role: user.Role };
};

const getGoogleClientId = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const error = new Error('Google sign-in is not configured on the server');
    error.statusCode = 503;
    throw error;
  }
  return clientId;
};

const verifyGoogleCredential = async (credential) => {
  if (typeof credential !== 'string' || !credential) {
    const error = new Error('Google credential is required');
    error.statusCode = 400;
    throw error;
  }

  const client = new OAuth2Client(getGoogleClientId());
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: credential,
      audience: getGoogleClientId()
    });
  } catch (verificationError) {
    if (verificationError.code || verificationError.response?.status) {
      verificationError.statusCode = 503;
      throw verificationError;
    }
    const error = new Error('Google credential is invalid or expired');
    error.statusCode = 401;
    throw error;
  }
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    const error = new Error('Google account email is not verified');
    error.statusCode = 401;
    throw error;
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.given_name || '',
    picture: payload.picture || ''
  };
};

const findUserByEmail = (User, email) =>
  User.findOne({ Email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });

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
  if (!user.Password) {
    throw new Error('This account uses Google sign-in');
  }

  const isMatch = await bcrypt.compare(Password, user.Password);
  if (!isMatch) throw new Error('Wrong password');

  await getLoginEventModel().create({ AccountID: user._id });
  return createSession(user);
};

const googleLogin = async (credential) => {
  const identity = await verifyGoogleCredential(credential);
  const User = getUserModel();
  const user = await User.findOne({ GoogleID: identity.googleId }) ||
    await findUserByEmail(User, identity.email);

  if (user) {
    if (user.GoogleID && user.GoogleID !== identity.googleId) {
      const error = new Error('This account is linked to a different Google account');
      error.statusCode = 409;
      throw error;
    }
    if (!user.GoogleID) {
      user.GoogleID = identity.googleId;
      await user.save();
    }
    await getLoginEventModel().create({ AccountID: user._id });
    return { message: 'Login success', ...createSession(user) };
  }

  const registrationToken = jwt.sign(
    {
      purpose: 'google-registration',
      googleId: identity.googleId,
      email: identity.email,
      name: identity.name,
      picture: identity.picture
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  return {
    registrationRequired: true,
    registrationToken,
    profile: { Email: identity.email, Name: identity.name, Avatar: identity.picture }
  };
};

const completeGoogleRegistration = async (registrationToken, profile = {}) => {
  if (typeof registrationToken !== 'string' || !registrationToken) {
    const error = new Error('Google registration session is required');
    error.statusCode = 400;
    throw error;
  }

  let identity;
  try {
    identity = jwt.verify(registrationToken, process.env.JWT_SECRET);
  } catch {
    const error = new Error('Google registration session is invalid or expired');
    error.statusCode = 401;
    throw error;
  }

  if (identity.purpose !== 'google-registration' || !identity.googleId || !identity.email) {
    const error = new Error('Google registration session is invalid');
    error.statusCode = 401;
    throw error;
  }

  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    const error = new Error('Registration profile is invalid');
    error.statusCode = 400;
    throw error;
  }

  const requiredFields = ['Name', 'Gender', 'Phone', 'Address', 'Birthday'];
  for (const field of requiredFields) {
    if (typeof profile[field] !== 'string' || !profile[field].trim()) {
      const error = new Error(`${field} is required`);
      error.statusCode = 400;
      throw error;
    }
  }
  if (!['male', 'female', 'other'].includes(profile.Gender)) {
    const error = new Error('Gender is invalid');
    error.statusCode = 400;
    throw error;
  }
  if (Number.isNaN(Date.parse(profile.Birthday)) || Date.parse(profile.Birthday) > Date.now()) {
    const error = new Error('Birthday is invalid');
    error.statusCode = 400;
    throw error;
  }

  const User = getUserModel();
  const Detail = getDetailModel();
  let user = await User.findOne({ GoogleID: identity.googleId }) ||
    await findUserByEmail(User, identity.email);

  if (!user) {
    user = await User.create({
      Email: identity.email,
      GoogleID: identity.googleId,
      Role: 'user'
    });

    try {
      await Detail.create({
        AccountID: user._id,
        Name: profile.Name.trim(),
        Gender: profile.Gender,
        Phone: profile.Phone.trim(),
        Address: profile.Address.trim(),
        Birthday: new Date(profile.Birthday),
        Avatar: identity.picture || ''
      });
    } catch (error) {
      try {
        await User.deleteOne({ _id: user._id });
      } catch (cleanupError) {
        console.error('Failed to clean up incomplete Google registration:', cleanupError.message);
      }
      throw error;
    }
  } else if (user.GoogleID && user.GoogleID !== identity.googleId) {
    const error = new Error('This email is linked to a different Google account');
    error.statusCode = 409;
    throw error;
  } else if (!user.GoogleID) {
    user.GoogleID = identity.googleId;
    await user.save();
  }

  return createSession(user);
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

const updateMyProfile = async (userId, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error = new Error('Profile data is required');
    error.statusCode = 400;
    throw error;
  }

  const requiredFields = ['Name', 'Gender', 'Phone', 'Address', 'Birthday'];
  for (const field of requiredFields) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      const error = new Error(`${field} is required`);
      error.statusCode = 400;
      throw error;
    }
  }
  if (!['male', 'female', 'other'].includes(data.Gender)) {
    const error = new Error('Gender is invalid');
    error.statusCode = 400;
    throw error;
  }
  const birthday = new Date(data.Birthday);
  if (Number.isNaN(birthday.getTime()) || birthday > new Date()) {
    const error = new Error('Birthday is invalid');
    error.statusCode = 400;
    throw error;
  }
  if (data.Avatar !== undefined && typeof data.Avatar !== 'string') {
    const error = new Error('Avatar must be a URL');
    error.statusCode = 400;
    throw error;
  }
  if (
    data.Avatar !== undefined &&
    data.Avatar !== '' &&
    !/^https?:\/\//i.test(data.Avatar.trim())
  ) {
    const error = new Error('Avatar must be an HTTP or HTTPS URL');
    error.statusCode = 400;
    throw error;
  }

  const User = getUserModel();
  const Detail = getDetailModel();
  const user = await User.findById(userId).select('-Password');
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  const detail = await Detail.findOneAndUpdate(
    { AccountID: user._id },
    {
      $set: {
        Name: data.Name.trim(),
        Gender: data.Gender,
        Phone: data.Phone.trim(),
        Address: data.Address.trim(),
        Birthday: birthday,
        ...(data.Avatar !== undefined ? { Avatar: data.Avatar.trim() } : {})
      },
      $setOnInsert: { AccountID: user._id }
    },
    { new: true, upsert: true, runValidators: true }
  );
  return { user, detail };
};

module.exports = {
  register,
  login,
  googleLogin,
  completeGoogleRegistration,
  getUserById,
  updateMyProfile
};