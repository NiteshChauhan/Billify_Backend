const mongoose = require("mongoose");

module.exports = function softDeletePlugin(schema) {
  schema.add({
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  });

  const applyNotDeletedFilter = function applyNotDeletedFilter() {
    if (this.getOptions?.().withDeleted) return;
    const query = this.getQuery();
    if (Object.prototype.hasOwnProperty.call(query, "isDeleted")) return;
    this.where({ isDeleted: false });
  };

  schema.pre("find", applyNotDeletedFilter);
  schema.pre("findOne", applyNotDeletedFilter);
  schema.pre("findOneAndUpdate", applyNotDeletedFilter);
  schema.pre("countDocuments", applyNotDeletedFilter);

  schema.pre("aggregate", function aggregateSoftDelete() {
    if (this.options?.withDeleted) return;
    const pipeline = this.pipeline();
    const firstStage = pipeline[0];
    if (firstStage?.$match && Object.prototype.hasOwnProperty.call(firstStage.$match, "isDeleted")) {
      return;
    }
    pipeline.unshift({ $match: { isDeleted: false } });
  });
};
