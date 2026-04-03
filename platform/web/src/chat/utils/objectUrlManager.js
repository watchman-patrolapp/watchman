// src/chat/utils/objectUrlManager.js
class ObjectUrlManager {
  constructor() {
    this.urls = new Map();
  }

  create(blob, id) {
    this.revoke(id);
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }

  revoke(id) {
    const url = this.urls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(id);
    }
  }

  revokeAll() {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
  }
}

export const objectUrlManager = new ObjectUrlManager();