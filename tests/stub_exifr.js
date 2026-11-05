// 测试用的假 exifr：按文件名从 window.__exif 里取拍摄地点和时间（真的 exifr 从照片的 EXIF 里读）
(function () {
  window.exifr = {
    parse: function (file) {
      var x = (window.__exif || {})[file.name];
      if (!x) return Promise.resolve(undefined);
      x = Object.assign({}, x);
      if (x.DateTimeOriginal) x.DateTimeOriginal = new Date(x.DateTimeOriginal);
      return Promise.resolve(x);
    },
    thumbnailUrl: function () { return Promise.resolve(undefined); }
  };
})();
