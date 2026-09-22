import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  CITY_OPTIONS,
  normalizeCityName,
  normalizeCitySearch,
  searchCities,
} from "./cities";
import "./city-picker.css";

const QUICK_CITIES = [
  "杭州",
  "南京",
  "上海",
  "北京",
  "广州",
  "深圳",
  "成都",
  "武汉",
  "不确定",
];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function CityPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (cities: string[]) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const selected = [...new Set(value.map(normalizeCityName).filter(Boolean))];
  const matches = useMemo(() => searchCities(query), [query]);
  const groups = useMemo(
    () => [...new Set(matches.map((city) => city.letter))],
    [matches],
  );
  const customCity = normalizeCityName(query);
  const canAdd =
    customCity.length > 0 &&
    !matches.length &&
    !selected.some(
      (city) => normalizeCitySearch(city) === normalizeCitySearch(customCity),
    );

  useEffect(() => {
    if (!open) return;
    function onOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document
      .getElementById(`${id}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);

  function toggleCity(city: string) {
    const exists = selected.includes(city);
    const next = exists
      ? selected.filter((item) => item !== city)
      : city === "不确定"
        ? [city]
        : [...selected.filter((item) => item !== "不确定"), city];
    onChange(next);
    setAnnouncement(
      `${exists ? "已移除" : "已选择"}${city}，共选择 ${next.length} 项`,
    );
  }

  function addCustomCity() {
    if (!canAdd) return;
    toggleCity(customCity);
    setQuery("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="city-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label className="city-picker-label" htmlFor={`${id}-search`}>
        意向城市 <span>（可多选）</span>
      </label>
      <p className="city-picker-help" id={`${id}-help`}>
        输入城市中文、拼音或首字母，也可以按 A–Z 浏览全国城市。
      </p>
      <div className="city-search-field">
        <Search size={19} aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${id}-search`}
          role="combobox"
          aria-label="搜索意向城市"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          aria-activedescendant={
            open && activeIndex >= 0 && matches[activeIndex]
              ? `${id}-option-${activeIndex}`
              : undefined
          }
          aria-describedby={`${id}-help`}
          placeholder="搜索城市，如 苏州 / suzhou / sz"
          value={query}
          maxLength={40}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!matches.length) return;
              setActiveIndex((index) =>
                event.key === "ArrowDown"
                  ? Math.min(index + 1, matches.length - 1)
                  : index < 0
                    ? matches.length - 1
                    : Math.max(0, index - 1),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                return;
              }
              const city = matches[activeIndex < 0 ? 0 : activeIndex];
              if (city) toggleCity(city.name);
              else if (canAdd) addCustomCity();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="city-input-action"
            aria-label="清空城市搜索"
            onClick={() => {
              setQuery("");
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="city-input-action"
          aria-label={open ? "收起全国城市" : "展开全国城市"}
          aria-expanded={open}
          onClick={() => {
            if (open) setOpen(false);
            else {
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
        >
          <ChevronDown
            className={open ? "city-chevron-open" : ""}
            size={20}
            aria-hidden="true"
          />
        </button>
      </div>

      {open && (
        <div className="city-dropdown">
          <div className="city-dropdown-heading">
            <strong>{query.trim() ? "搜索结果" : "全国城市"}</strong>
            <span>{matches.length} 个城市 / 地区</span>
          </div>
          {!query.trim() && (
            <nav className="city-letter-index" aria-label="按拼音首字母浏览">
              {LETTERS.map((letter) => (
                <button
                  type="button"
                  key={letter}
                  disabled={!groups.includes(letter)}
                  aria-label={`跳到 ${letter} 开头的城市`}
                  onClick={() => {
                    const index = matches.findIndex(
                      (city) => city.letter === letter,
                    );
                    if (index >= 0) {
                      setActiveIndex(index);
                      inputRef.current?.focus();
                    }
                  }}
                >
                  {letter}
                </button>
              ))}
            </nav>
          )}
          <div
            id={`${id}-list`}
            className="city-options"
            role="listbox"
            aria-label="全国城市"
            aria-multiselectable="true"
          >
            {groups.map((letter) => (
              <div
                key={letter}
                role="group"
                aria-label={`${letter} 开头的城市`}
              >
                <div className="city-group-letter" aria-hidden="true">
                  {letter}
                </div>
                <div className="city-group-grid">
                  {matches.map((city, index) =>
                    city.letter !== letter ? null : (
                      <button
                        type="button"
                        key={city.code}
                        id={`${id}-option-${index}`}
                        role="option"
                        tabIndex={-1}
                        aria-label={`${city.name}，${city.province}`}
                        aria-selected={selected.includes(city.name)}
                        className={`city-option ${activeIndex === index ? "city-option-active" : ""}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          toggleCity(city.name);
                          setActiveIndex(index);
                          inputRef.current?.focus();
                        }}
                      >
                        <span className="city-option-copy">
                          <span>{city.name}</span>
                          <small>{city.province}</small>
                        </span>
                        {selected.includes(city.name) && (
                          <Check size={18} aria-hidden="true" />
                        )}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          {!matches.length && (
            <div className="city-empty">
              <p>未找到匹配城市，可以直接添加你想去的城市。</p>
              {canAdd ? (
                <button type="button" onClick={addCustomCity}>
                  添加自定义城市「{customCity}」
                </button>
              ) : (
                <span>
                  {customCity ? "该城市已在已选列表中" : "请输入城市名称"}
                </span>
              )}
            </div>
          )}
          <p className="city-keyboard-help">
            可多选 · ↑ ↓ 移动 · Enter 选择 · Esc 收起
          </p>
        </div>
      )}

      <div className="city-quick-row" aria-label="常用意向城市">
        <span>常用城市</span>
        <div className="city-quick-options">
          {QUICK_CITIES.map((city) => (
            <button
              type="button"
              key={city}
              aria-pressed={selected.includes(city)}
              onClick={() => toggleCity(city)}
            >
              {selected.includes(city) && (
                <Check size={16} aria-hidden="true" />
              )}
              {city}
            </button>
          ))}
        </div>
      </div>
      {!!selected.length && (
        <div className="city-selected" aria-label="已选意向城市">
          <span>已选 {selected.length} 项</span>
          <div className="city-selected-tags">
            {selected.map((city) => (
              <button
                type="button"
                key={city}
                aria-label={`移除意向城市${city}`}
                onClick={() => toggleCity(city)}
              >
                {city}
                <X size={15} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}
      <span className="city-sr-only" aria-live="polite">
        {announcement}
      </span>
      <span className="city-sr-only">
        城市目录包含 {CITY_OPTIONS.length} 个城市及地区选项。
      </span>
    </div>
  );
}
