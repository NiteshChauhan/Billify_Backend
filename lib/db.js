const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  if (!process.env.MONGODB_URI) {
    throw new Error("❌ MONGODB_URI not defined");
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false, // 🔥 important for serverless
    });

    isConnected = true;
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    throw err;
  }
};

module.exports = connectDB;
