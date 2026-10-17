const service = require('./auth.service');

const register = async (req, res) => {
  try {
    const user = await service.register(req.body);
    res.json({ message: 'Register success', user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { Email, Password } = req.body;
    const result = await service.login(Email, Password);
    res.json({ message: 'Login success', ...result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const googleLogin = async (req, res) => {
  try {
    const result = await service.googleLogin(req.body?.credential);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const completeGoogleRegistration = async (req, res) => {
  try {
    const result = await service.completeGoogleRegistration(
      req.body?.registrationToken,
      req.body?.profile
    );
    res.json({ message: 'Registration complete', ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await service.getUserById(userId);
    res.json({ message: 'User found', user });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    const data = await service.getUserById(req.user.userId);

    return res.json(data);
  } catch (err) {
    return res.status(400).json({
      message: err.message
    });
  }
};

const updateMe = async (req, res) => {
  try {
    const data = await service.updateMyProfile(req.user.userId, req.body);
    return res.json({ message: 'Profile updated', ...data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
};

module.exports = {
  register,
  login,
  googleLogin,
  completeGoogleRegistration,
  getUserById,
  getMe,
  updateMe
};