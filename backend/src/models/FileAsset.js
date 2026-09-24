const mongoose = require("mongoose");

const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    name: String,
    url: String,
    size: Number,
    mimeType: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const fileSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    name: { type: String, required: true },
    originalName: { type: String },
    url: { type: String, required: true },
    size: { type: Number, default: 0 },
    type: { type: String, default: "file" }, // pdf | image | zip | doc | code | file
    mimeType: { type: String },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    downloads: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    versions: [versionSchema],
    aiAnalysis: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FileAsset", fileSchema);
