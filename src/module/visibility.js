'use strict';

// Go-style visibility: identifier starting with an uppercase letter is
// public/exported, lowercase is internal/unexported. No keyword needed.
function isPublicName(name) {
  return /^[A-Z]/.test(name);
}

module.exports = { isPublicName };
