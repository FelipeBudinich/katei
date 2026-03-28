exports.readShared = function readShared() {
  return process.env.SHARED_TOKEN || "";
};
