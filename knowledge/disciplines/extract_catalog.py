"""Rebuild the national taxonomy from the archived official 2022 PDF, without OCR guesses.

Run using a Python environment with pypdf. This script reads the local original; it does
not fetch or silently replace official materials. Source updates require review.
"""
from pathlib import Path
from hashlib import sha256
import json
import re
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
PDF = ROOT / "sources" / "moe-graduate-catalog-2022.pdf"
CHECKED_AT = "2026-09-27"
ORIGINAL_URL = "https://www.moe.gov.cn/srcsite/A22/moe_833/202209/W020220914572994461110.pdf"
MIRROR_URL = "https://webplus.chd.edu.cn/_upload/article/files/00/2f/f9d3977646529ced5e6242ba6e34/f637f2ae-61df-4de4-a12f-6c1f855861a9.pdf"


def build():
    groups, items = [], []
    group = None
    for page_num, page in enumerate(PdfReader(PDF).pages, 1):
        if page_num < 3:
            continue
        for original_line in page.extract_text().splitlines():
            line = "".join(original_line.split())
            group_match = re.match(r"^(\d{2})([^\d].*)$", line)
            if group_match:
                group = {"code": group_match[1], "name": group_match[2]}
                groups.append(group)
                continue
            item_match = re.match(r"^(\d{4})([^\d].*)$", line)
            if item_match:
                code, raw = item_match.groups()
                professional = int(code[2]) >= 5
                items.append({
                    "id": code, "code": code,
                    "name": re.split(r"[（(]", raw)[0].rstrip("*"),
                    "groupCode": group["code"], "groupName": group["name"],
                    "degreeType": "professional" if professional else "academic",
                    "level": "professional_category" if professional else "first_level_discipline",
                    "mastersOnly": raw.endswith("*"),
                    "notes": [raw[raw.index("（"):]] if "（" in raw else [],
                    "aliases": [], "sourceIds": ["moe-catalog-2022"], "sourcePage": page_num,
                })
            elif items and not re.match(r"^—\d+—$", line) and items[-1]["notes"]:
                items[-1]["notes"][-1] += line
    # These professional categories are expressly listed inside the medical academic
    # entries rather than as separate table rows. Omitting them incorrectly yields 64.
    for parent, code in [("1002", "1051"), ("1003", "1052"), ("1007", "1055")]:
        original = next(item for item in items if item["code"] == parent)
        assert any(code in note for note in original["notes"])
        items.append({**original, "id": code, "code": code,
                      "degreeType": "professional", "level": "professional_category",
                      "notes": [f"由原文 {parent} 条目明确标注的“同时设专业学位类别”展开。"]})
    aliases_2025 = {"0453": ["汉语国际教育"], "0651": ["文物与博物馆"],
                    "0862": ["风景园林学"], "0851": ["建筑学"], "0853": ["城市规划"]}
    for item in items:
        if item["code"] in aliases_2025:
            item["aliases"] = aliases_2025[item["code"]]
            item["sourceIds"] = [*item["sourceIds"], "moe-correspondence-2025"]
    items.sort(key=lambda item: item["code"])
    assert len(groups) == 14
    assert sum(item["degreeType"] == "academic" for item in items) == 117
    assert sum(item["degreeType"] == "professional" for item in items) == 67
    assert len({item["code"] for item in items}) == 184
    return {
        "schemaVersion": 1, "catalogVersion": "moe-graduate-2022-checked-20260927-v1",
        "title": "研究生教育学科专业目录（2022年）", "asOf": CHECKED_AT, "effectiveFrom": "2023",
        "coverage": {"disciplineGroups": 14, "academicDisciplines": 117,
                     "professionalCategories": 67, "total": 184,
                     "description": "覆盖教育部 2022 年国家目录的全部 14 个门类、117 个一级学科和 67 个专业学位类别；不等于全国年度招生项目。"},
        "groups": groups, "items": items,
        "sources": [
            {"sourceId": "moe-catalog-2022", "title": "研究生教育学科专业目录（2022年）", "publisher": "国务院学位委员会、教育部",
             "url": ORIGINAL_URL, "retrievedFrom": MIRROR_URL, "publishedAt": "2022-09-13", "checkedAt": CHECKED_AT,
             "sha256": sha256(PDF.read_bytes()).hexdigest(),
             "note": "教育部原附件；本次教育部附件连接异常，经长安大学官方网站同版原件提取并核对。代码名称与医学附注保留原文依据。"},
            {"sourceId": "moe-correspondence-2025", "title": "教育部办公厅关于印发《有关学科专业调整对应关系表》等的通知", "publisher": "教育部办公厅",
             "url": "https://www.moe.gov.cn/srcsite/A22/s7065/202506/t20250611_1193766.html",
             "retrievedFrom": "https://gs.tju.edu.cn/info/1181/14242.htm", "publishedAt": "2025-01-26", "checkedAt": CHECKED_AT,
             "note": "教研厅函〔2025〕2号；核对旧新名称与专业领域对应，不将专业领域或学校授权点算作新增一级学科。"},
            {"sourceId": "moe-classification-reference-2026", "title": "关于教育部2026年度公务员考录职位要求的说明", "publisher": "教育部",
             "url": "https://www.moe.gov.cn/s78/A04/tongzhi/202510/t20251015_1416829.html",
             "retrievedFrom": "https://www.moe.gov.cn/s78/A04/tongzhi/202510/t20251015_1416829.html", "publishedAt": "2025-10-15", "checkedAt": CHECKED_AT,
             "note": "教育部关于2026年度考录的说明仍将研究生专业分类链接至2022国家目录，用作版本交叉核对，不推导任何个人考录资格。"}
        ],
        "warnings": [
            "这是全国基础学科分类目录，不能证明某校某年招生、考试科目或个人报考资格。",
            "已核对2025年调整对应表；本快照不是各校二级学科、自设学科、交叉方向及六位年度招生专业的全量目录，也不覆盖未接入的急需清单。",
            "目录更新需重新采集官方原件并审核发布；不声称实时覆盖此后未接入的调整。",
            "星号只表示目录中仅可授硕士专业学位；无星号不代表每所学校均有博士授权。"
        ]
    }


if __name__ == "__main__":
    output = build()
    (ROOT / "catalog.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Extracted 14 groups, 117 academic disciplines, 67 professional categories.")
