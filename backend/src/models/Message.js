const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", index: true },
    // For direct messages: sorted "userA_userB" key
    conversation: { type: String, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Not required at the schema level: a file-only chat message (an
    // attachment with no caption) is valid and must be allowed to save.
    // The "must have text OR at least one attachment" rule is enforced
    // below via a custom validator instead of `required: true`.
    text: { type: String, trim: true, maxlength: 4000, default: "" },
    // PRIVATE VOICE MESSAGES — additive top-level field, defaults to "text"
    // so every existing message (and every existing group message, which
    // never sets this) continues to behave exactly as before. Only
    // chatController.sendDirectMessage ever sets this to "voice", and only
    // when the message is a single audio attachment with no caption text
    // (see sanitizeAttachments/sendDirectMessage) — sendGroupMessage never
    // touches this field, so group messages are always "text".
    type: { type: String, enum: ["text", "voice", "image", "video"], default: "text" },
    attachments: [
      {
        name: String,
        url: String,
        size: Number,
        // NOTE: `type` must be written as `{ type: { type: String } }` here —
        // Mongoose reserves a bare `type: String` key inside a schema
        // definition as its own special "field type" syntax, not a field
        // named `type`. Writing it the short way (as the previous version
        // of this schema did) silently swallows every other key in the
        // object ({name, url, size, mimeType} all vanish on cast) because
        // Mongoose treats the whole object as SchemaTypeOptions instead of
        // a subdocument definition. This is why attachments never actually
        // persisted even when a caller did send them.
        type: { type: String },
        mimeType: String,
        // PRIVATE VOICE MESSAGES — actual recorded duration in whole
        // seconds, reported by the client's real MediaRecorder session and
        // clamped server-side (see chatController.sanitizeAttachments).
        // Only ever set for a voice attachment (type: "audio"); left
        // undefined for ordinary file attachments.
        duration: Number,
      },
    ],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    editedAt: Date,
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.statics.conversationKey = (a, b) => [String(a), String(b)].sort().join("_");

// A message must carry either a non-empty text body or at least one
// attachment (file-only messages are valid; a completely empty message
// is not). Uses `this.invalidate(...)` rather than `next(new Error(...))`
// so this produces a real Mongoose ValidationError (name: "ValidationError")
// — the existing global error handler (middleware/error.js) already maps
// that to a clean 400 response; a plain Error here would instead fall
// through to an unhandled 500 for what is really just a bad request.
messageSchema.pre("validate", function enforceContent(next) {
  const hasText = !!(this.text && this.text.trim());
  const hasAttachments = Array.isArray(this.attachments) && this.attachments.length > 0;
  if (!hasText && !hasAttachments) {
    this.invalidate("text", "Message must contain text or at least one attachment");
  }
  next();
});

module.exports = mongoose.model("Message", messageSchema);
