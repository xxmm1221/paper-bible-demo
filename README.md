# 纸页 · 纸质圣经阅读体验 Demo

一个围绕经文「空间位置记忆」设计的浏览器阅读原型。手机上可缩放、平移整本书；平板横屏可以看到完整的左右对开。

## 试用

GitHub Pages：https://xxmm1221.github.io/paper-bible-demo/

无需账号，无后端、无分析追踪。阅读位置只保存在当前浏览器本地。

## 已实现

- 全书固定原型排版：66 卷、1189 章、1254 个固定纸面页。屏幕变化只改变观看窗口，不重新排版。
- 左右对开与随阅读位置变化的书页厚度；底部显示全书位置。
- 单指慢拖平移，双指捏合缩放，双击放大 / 还原。
- 单指快滑翻 1 页；双指同向快滑先翻 5 页，连续同向快滑加速到 10、20 页。
- 起手在实体左页时，仅向右快滑前翻；起手在实体右页时，仅向左快滑后翻。反方向只移动。
- 「看书侧」显示 66 卷简称标签，点击直接翻到对应书卷。
- 鼠标、键盘及桌面手势演示。

“翻 1 页”指翻动一张纸，切换到下一组对开；所以纸面页码前进 2。

## 体验边界

当前为参考小开本双栏风格的体验排版，不对应某一实体圣经的真实页码与行文。后续可接入获得使用授权的扫描页。多指手势的速度阈值、移动系统边缘手势和触感仍需真机试用。

## 本地运行与检查

无需安装依赖。目录内运行：

```sh
python -m http.server 8765 --bind 127.0.0.1
node --check app.js
node test-gestures.cjs
```

然后打开本机 8765 端口。本次原型的手势规则与固定版面检查共 92 项。

## 来源与许可说明

- 内页风格参考：[小开本和合本实物](https://www.bibleinmylanguage.com/chinese-bible-midsize-black-black-pvc-covered-chinese-union-version-the-most-popular-bible-in-mainland-china-with-thumb-index-golden-letters-on-cover-red-edges-cuv-holy-bible/)。仓库不包含该商家的照片。
- 经文来源：[eBible 新标点和合本](https://ebible.org/cmn-cu89s/copyright.htm)，来源标注 Public Domain。保留源文本的合并节号，按合并范围计 31092 节，不以其他译本的节数修改文本。
- 字形：[Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)，SIL Open Font License 1.1，许可副本在 `fonts/LICENSE.txt`。只打包本原型需要的字符子集。

本仓库只包含独立 Demo 的发布文件与测试，不含其他项目源码、私有部署配置、个人资料或凭证。
