# Demo 城市目录来源与范围

`src/cities.ts` 是随前端打包的静态目录，城市搜索与选择无需联网。

## 来源

- 数据包：[`china-division@2.7.0`](https://www.npmjs.com/package/china-division/v/2.7.0)。提取其 `dist/pc-code.json` 以及 `dist/HK-MO-TW.json`，下载日期 2026-09-23。
- 上游仓库：[`modood/Administrative-divisions-of-China`](https://github.com/modood/Administrative-divisions-of-China)。包内 README 对大陆数据标注为 **2023 年统计用区划代码**，统计截止时间 **2023-06-30**。
- 拼音为开发时使用 [`pinyin-pro@3.29.4`](https://www.npmjs.com/package/pinyin-pro/v/3.29.4) 生成的无声调字符串与每字拼音首字母。前端不包含该库，无新增运行依赖。已核对重庆为 `chongqing / cq`，属于 C 组；长沙、长春属于 C 组；六安属于 L 组。

## 提取与显示规则

目录共 **391 个选项**：大陆 **369 项**（地级市、自治州、地区、盟、4 个直辖市，以及源数据中的省或自治区直辖县级选项），香港、澳门各 1 项，台湾源数据中的 20 个城市或县选项。

直辖市取省级名称，不把其区县作为独立城市；其余大陆省份取 `pc-code.json` 的下一层，保留该来源的省直辖县级选项。香港、澳门分别提供整体入口；台湾从 `HK-MO-TW.json` 下一层提取，不展开区、乡、镇。仅移除城市名称末尾的“市”，与历史画像中的“杭州”“南京”等字符串兼容；自治州、盟、地区、县、林区的名称保留。每项同时显示所在省份或地区，按拼音排序并按首字母 A–Z 分组。

这是用于选择交互的版本快照，**不代表 2026 年实时或穷尽的行政区划名录**，也不意味着所列地区均有演示院校。未覆盖的县级城市、新设或更名城市等可在搜索无匹配时通过“添加自定义城市”补充。港澳台源数据没有单独公布同样的 2023 年统计截止时间，不能将大陆数据日期套用于该部分。生产接入时应另行维护和审核城市标准库。

## 上游数据许可证

`china-division@2.7.0` 的 npm 元数据将 license 字段写为 MIT，但包内 LICENSE 与上游 README 使用 WTFPL。这里保留实际随数据分发的许可证原文，不将其改写为 MIT：

```text
        DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
                    Version 2, December 2004

 Copyright (C) 2004 Sam Hocevar <sam@hocevar.net>

 Everyone is permitted to copy and distribute verbatim or modified
 copies of this license document, and changing it is allowed as long
 as the name is changed.

            DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. You just DO WHAT THE FUCK YOU WANT TO.
```
