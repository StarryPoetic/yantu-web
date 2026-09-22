import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
type Direction = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
type PopupPosition = {
  left: number;
  width: number;
  maxHeight: number;
  edge: number;
  placement: "top" | "bottom";
};

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
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
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

  // Anchor the panel to the visible viewport, including the space left by a
  // mobile keyboard. Only the options scroll; the input and footer stay visible.
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    function measure() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportBottom =
        viewportTop + (viewport?.height ?? window.innerHeight);
      const viewportWidth = viewport?.width ?? window.innerWidth;
      if (rect.bottom <= viewportTop || rect.top >= viewportBottom) {
        setOpen(false);
        return;
      }
      const below = Math.max(0, viewportBottom - rect.bottom - 20);
      const above = Math.max(0, rect.top - viewportTop - 20);
      const placement = below >= 360 || below >= above ? "bottom" : "top";
      const width = Math.min(rect.width, viewportWidth - 24);
      const next: PopupPosition = {
        left: Math.max(
          viewportLeft + 12,
          Math.min(rect.left, viewportLeft + viewportWidth - width - 12),
        ),
        width,
        maxHeight: Math.min(560, placement === "bottom" ? below : above),
        edge:
          placement === "bottom"
            ? rect.bottom + 8
            : window.innerHeight - rect.top + 8,
        placement,
      };
      setPosition((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof PopupPosition] ===
            next[key as keyof PopupPosition],
        )
          ? previous
          : next,
      );
    }
    function schedule(event?: Event) {
      // Scrolling the list must not shift the page or reposition its panel.
      if (
        event?.target instanceof Node &&
        listRef.current?.contains(event.target)
      )
        return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    measure();
    const observer = new ResizeObserver(() => schedule());
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    if (activeIndex < 0) {
      list.scrollTop = 0;
      return;
    }
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    if (!option) return;
    const bounds = list.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    const padding = Math.max(0, Math.min(8, (bounds.height - item.height) / 2));
    if (item.top < bounds.top + padding)
      list.scrollTop -= bounds.top + padding - item.top;
    else if (item.bottom > bounds.bottom - padding)
      list.scrollTop += item.bottom - bounds.bottom + padding;
  }, [activeIndex, id, open, matches, position?.maxHeight, position?.width]);

  function moveActive(direction: Direction) {
    setOpen(true);
    if (!matches.length) return;
    if (activeIndex < 0) {
      setActiveIndex(
        direction === "ArrowUp" || direction === "ArrowLeft"
          ? matches.length - 1
          : 0,
      );
      return;
    }
    if (direction === "ArrowLeft" || direction === "ArrowRight") {
      setActiveIndex(
        Math.max(
          0,
          Math.min(
            matches.length - 1,
            activeIndex + (direction === "ArrowLeft" ? -1 : 1),
          ),
        ),
      );
      return;
    }
    // Follow actual grid rows, including short rows at alphabet boundaries and
    // the two-column mobile layout, rather than assuming a fixed column count.
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(".city-option") ?? [],
    );
    const current = items[activeIndex]?.getBoundingClientRect();
    if (!current) return;
    const rows = items
      .map((item, index) => ({ index, rect: item.getBoundingClientRect() }))
      .filter(({ rect }) =>
        direction === "ArrowDown"
          ? rect.top > current.top + 2
          : rect.top < current.top - 2,
      );
    if (!rows.length) return;
    const nearestTop = rows.reduce(
      (nearest, { rect }) =>
        Math.abs(rect.top - current.top) < Math.abs(nearest - current.top)
          ? rect.top
          : nearest,
      rows[0].rect.top,
    );
    const nextRow = rows.filter(
      ({ rect }) => Math.abs(rect.top - nearestTop) < 2,
    );
    const center = current.left + current.width / 2;
    const nearest = nextRow.reduce((best, item) =>
      Math.abs(item.rect.left + item.rect.width / 2 - center) <
      Math.abs(best.rect.left + best.rect.width / 2 - center)
        ? item
        : best,
    );
    setActiveIndex(nearest.index);
  }

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
    inputRef.current?.focus({ preventScroll: true });
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
      <div ref={anchorRef} className="city-search-field">
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
          onClick={() => setOpen(true)}
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
            } else if (
              ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(
                event.key,
              )
            ) {
              // Before entering the results, horizontal keys retain their usual
              // text-editing behavior for a nonempty search query.
              if (
                query &&
                activeIndex < 0 &&
                (event.key === "ArrowLeft" || event.key === "ArrowRight")
              )
                return;
              event.preventDefault();
              moveActive(event.key as Direction);
            } else if (
              (event.key === "Home" || event.key === "End") &&
              open &&
              (!query || activeIndex >= 0)
            ) {
              event.preventDefault();
              setActiveIndex(event.key === "Home" ? 0 : matches.length - 1);
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
              inputRef.current?.focus({ preventScroll: true });
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
              inputRef.current?.focus({ preventScroll: true });
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
        <div
          className={`city-dropdown ${position && position.maxHeight < 440 ? "city-dropdown-compact" : ""}`}
          data-placement={position?.placement}
          style={
            position
              ? {
                  left: position.left,
                  width: position.width,
                  maxHeight: position.maxHeight,
                  ...(position.placement === "bottom"
                    ? { top: position.edge }
                    : { bottom: position.edge }),
                }
              : { visibility: "hidden" }
          }
        >
          <div className="city-dropdown-heading">
            <strong>{query.trim() ? "搜索结果" : "全国城市"}</strong>
            <span>{matches.length} 个城市 / 地区</span>
          </div>
          {!query.trim() && (
            <nav className="city-letter-index" aria-label="按拼音首字母浏览">
              {groups.map((letter) => (
                <button
                  type="button"
                  key={letter}
                  aria-label={`跳到 ${letter} 开头的城市`}
                  onClick={() => {
                    const index = matches.findIndex(
                      (city) => city.letter === letter,
                    );
                    if (index >= 0) {
                      setActiveIndex(index);
                      inputRef.current?.focus({ preventScroll: true });
                    }
                  }}
                >
                  {letter}
                </button>
              ))}
            </nav>
          )}
          <div
            ref={listRef}
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
                          inputRef.current?.focus({ preventScroll: true });
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
          <div className="city-keyboard-help">
            <div className="city-move-controls" aria-label="移动城市选项">
              {(
                [
                  ["ArrowLeft", "←", "向左移动城市"],
                  ["ArrowUp", "↑", "向上移动城市"],
                  ["ArrowDown", "↓", "向下移动城市"],
                  ["ArrowRight", "→", "向右移动城市"],
                ] as const
              ).map(([direction, symbol, label]) => (
                <button
                  key={direction}
                  type="button"
                  aria-label={label}
                  title={label}
                  disabled={!matches.length}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    moveActive(direction);
                    inputRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {symbol}
                </button>
              ))}
            </div>
            <span>方向键移动 · Enter 选择 · Esc 收起</span>
          </div>
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
