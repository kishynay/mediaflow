const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
    trim: true
  },
  originalName: {
    type: String,
    required: true
  },
  contentType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: {
      type: String,
      enum: ['video', 'audio', 'image', 'other'],
      required: true
    },
    width: Number,
    height: Number,
    duration: Number
  },
  gridFsId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }
});

// Index for faster queries
mediaSchema.index({ uploadDate: -1 });
mediaSchema.index({ 'metadata.type': 1 });

module.exports = mongoose.model('Media', mediaSchema);