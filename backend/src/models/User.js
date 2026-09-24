const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    size: { type: Number, default: 0 },
    mimeType: { type: String, default: "" },
    issuer: { type: String, default: "" },
    issuedOn: { type: Date },
    credentialUrl: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email address"],
    },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ["student", "guide", "admin"], default: "student" },
    dept: { type: String, default: "" },
    color: { type: String, default: "#5B5FEF" },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "" },

    /* ---------------- Personal information ---------------- */
    personal: {
      phone: { type: String, default: "" },
      dateOfBirth: { type: Date },
      gender: { type: String, enum: ["male", "female", "other", "prefer-not-to-say", ""], default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },

    /* ---------------- Academic information ---------------- */
    academic: {
      college: { type: String, default: "" },
      university: { type: String, default: "" },
      degree: { type: String, default: "" },
      enrollmentNumber: { type: String, default: "" },
      branch: { type: String, default: "" },
      year: { type: String, default: "" },
      semester: { type: String, default: "" },
      rollNumber: { type: String, default: "" },
      registrationNumber: { type: String, default: "" },
      cgpa: { type: Number, min: 0, max: 10 },
      tenthPercentage: { type: Number, min: 0, max: 100 },
      interPercentage: { type: Number, min: 0, max: 100 },
      graduationYear: { type: String, default: "" },
    },

    /* ------------- Professional info (guides / faculty) ------------- */
    professional: {
      designation: { type: String, default: "" },
      employeeId: { type: String, default: "" },
      college: { type: String, default: "" },
      department: { type: String, default: "" },
      qualification: { type: String, default: "" },
      specialization: { type: String, default: "" },
      experienceYears: { type: Number, min: 0, max: 60 },
      officeRoom: { type: String, default: "" },
      officeHours: { type: String, default: "" },
    },
    researchInterests: [{ type: String }],

    /* ---------------- Skills ---------------- */
    skills: [{ type: String }], // technical skills
    programmingLanguages: [{ type: String }],
    frameworks: [{ type: String }],
    tools: [{ type: String }],

    /* ---------------- Documents ---------------- */
    resume: {
      name: String,
      url: String,
      size: Number,
      mimeType: String,
      uploadedAt: Date,
    },
    certifications: [documentSchema],

    /* ---------------- Social links ---------------- */
    social: {
      github: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      portfolio: { type: String, default: "" },
      twitter: { type: String, default: "" },
    },

    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    otp: { code: String, expiresAt: Date },
    lastSeenAt: { type: Date, default: Date.now },
    settings: {
      emailNotifications: { type: Boolean, default: true },
      pushNotifications: { type: Boolean, default: true },
      theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/** Rough completeness score so the UI can nudge students to finish their profile. */
userSchema.virtual("profileCompletion").get(function completion() {
  const checks = [
    this.name,
    this.email,
    this.avatar,
    this.personal?.phone,
    this.personal?.dateOfBirth,
    this.personal?.address,
    this.academic?.college,
    this.academic?.branch,
    this.academic?.rollNumber,
    this.academic?.cgpa,
    this.skills?.length,
    this.programmingLanguages?.length,
    this.resume?.url,
    this.certifications?.length,
    this.social?.github || this.social?.linkedin,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
});

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  // Skip when the value is already a bcrypt hash (signup flow pre-hashes it).
  if (/^\$2[aby]\$\d{2}\$/.test(this.password)) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model("User", userSchema);
