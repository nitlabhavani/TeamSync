const mongoose = require("mongoose");

const peerReviewSchema = new mongoose.Schema(
  {
    round: { type: mongoose.Schema.Types.ObjectId, ref: "ReviewRound", required: true, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reviewee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scores: {
      contribution: { type: Number, min: 1, max: 5, required: true },
      communication: { type: Number, min: 1, max: 5, required: true },
      reliability: { type: Number, min: 1, max: 5, required: true },
      helpfulness: { type: Number, min: 1, max: 5, required: true },
    },
    comment: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

peerReviewSchema.index({ round: 1, reviewer: 1, reviewee: 1 }, { unique: true });

peerReviewSchema.virtual("average").get(function average() {
  const s = this.scores;
  return (s.contribution + s.communication + s.reliability + s.helpfulness) / 4;
});

peerReviewSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("PeerReview", peerReviewSchema);
