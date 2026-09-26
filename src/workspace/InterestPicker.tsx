import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";
import "./interest-picker.css";

const collator = new Intl.Collator("zh-CN-u-co-pinyin");
const initials = [
  ["A", "阿"],
  ["B", "八"],
  ["C", "擦"],
  ["D", "搭"],
  ["E", "蛾"],
  ["F", "发"],
  ["G", "噶"],
  ["H", "哈"],
  ["J", "击"],
  ["K", "喀"],
  ["L", "垃"],
  ["M", "妈"],
  ["N", "拿"],
  ["O", "哦"],
  ["P", "啪"],
  ["Q", "期"],
  ["R", "然"],
  ["S", "撒"],
  ["T", "塌"],
  ["W", "挖"],
  ["X", "昔"],
  ["Y", "压"],
  ["Z", "匝"],
] as const;
const separator = /[、，,；;\n]/;
function initial(name: string) {
  const character = name.trim()[0] ?? "";
  if (/^[a-z]$/i.test(character)) return character.toUpperCase();
  for (let i = initials.length - 1; i >= 0; i--)
    if (collator.compare(character, initials[i][1]) >= 0) return initials[i][0];
  return "#";
}

/** A free-text combobox: choosing a suggestion never discards earlier interests. */
export function InterestPicker({
  value,
  options,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const [position, setPosition] = useState({ above: false, height: 320 });
  const indexed = useMemo(
    () =>
      [...new Set(options)]
        .map((name) => ({ name, initial: initial(name) }))
        .sort(
          (a, b) =>
            a.initial.localeCompare(b.initial) ||
            collator.compare(a.name, b.name),
        ),
    [options],
  );
  const matches = useMemo(
    () =>
      indexed.filter(
        (item) =>
          !search.trim() ||
          item.name.includes(search.trim()) ||
          item.initial === search.trim().toUpperCase(),
      ),
    [indexed, search],
  );
  const groups = [...new Set(matches.map((item) => item.initial))];
  const selected = new Set(value.split(separator).map((item) => item.trim()));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const below = Math.max(0, bottom - rect.bottom - 12);
      const above = Math.max(0, rect.top - top - 12);
      const useAbove = below < 220 && above > below;
      setPosition({
        above: useAbove,
        height: Math.min(320, useAbove ? above : below),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open]);
  useLayoutEffect(() => {
    const option = document.getElementById(`${id}-option-${active}`);
    if (!open || !option || !list.current) return;
    const optionRect = option.getBoundingClientRect(),
      listRect = list.current.getBoundingClientRect();
    if (optionRect.top < listRect.top)
      list.current.scrollTop -= listRect.top - optionRect.top;
    else if (optionRect.bottom > listRect.bottom)
      list.current.scrollTop += optionRect.bottom - listRect.bottom;
  }, [active, id, open]);
  function choose(name: string) {
    const parts = value.split(separator);
    if (search.trim()) parts.pop();
    const next = [
      ...new Set([...parts.map((item) => item.trim()).filter(Boolean), name]),
    ].join("、");
    if (next.length > 200) {
      setAnnouncement("兴趣内容最多200个字符，请先精简后再添加。");
      return;
    }
    onChange(next);
    setOpen(false);
    setSearch("");
    setActive(-1);
    setAnnouncement(`已加入${name}，还可继续输入其他兴趣。`);
    input.current?.focus();
  }
  return (
    <div
      ref={root}
      className="interest-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={`${id}-input`}>{label}</label>
      <div ref={anchor} className="interest-anchor">
        <input
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && active >= 0 ? `${id}-option-${active}` : undefined
          }
          aria-describedby={`${id}-help`}
          value={value}
          placeholder={placeholder}
          maxLength={200}
          autoComplete="off"
          onFocus={() => {
            setOpen(true);
            setSearch("");
            setActive(-1);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setSearch(event.target.value.split(separator).at(-1) ?? "");
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              setOpen(false);
              event.preventDefault();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                !matches.length
                  ? -1
                  : event.key === "ArrowDown"
                    ? Math.min(index + 1, matches.length - 1)
                    : index < 0
                      ? matches.length - 1
                      : Math.max(0, index - 1),
              );
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              if (active >= 0 && matches[active]) choose(matches[active].name);
              else setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="interest-toggle"
          aria-label={open ? "收起专业兴趣建议" : "展开专业兴趣建议"}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else {
              input.current?.focus();
              setSearch("");
              setActive(-1);
              setOpen(true);
            }
          }}
        >
          <ChevronDown size={17} />
        </button>
        {open && (
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="专业兴趣建议"
            className={`interest-popup${position.above ? " interest-popup-above" : ""}`}
            style={{ maxHeight: position.height }}
          >
            {groups.map((letter) => (
              <div
                role="group"
                aria-labelledby={`${id}-group-${letter}`}
                key={letter}
              >
                <div className="interest-initial" id={`${id}-group-${letter}`}>
                  {letter}
                </div>
                {matches.map((item, index) =>
                  item.initial !== letter ? null : (
                    <button
                      type="button"
                      role="option"
                      tabIndex={-1}
                      key={item.name}
                      id={`${id}-option-${index}`}
                      aria-selected={selected.has(item.name)}
                      className={`interest-option${active === index ? " interest-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(item.name)}
                    >
                      {item.name}
                      {selected.has(item.name) && (
                        <span aria-hidden="true">已选</span>
                      )}
                    </button>
                  ),
                )}
              </div>
            ))}
            {!matches.length && (
              <p className="interest-empty">
                没有匹配的目录名称。可以保留自由输入，多个兴趣用顿号分隔。
              </p>
            )}
          </div>
        )}
      </div>
      <small id={`${id}-help`}>
        按拼音首字母排列；可填写多个兴趣，用顿号分隔。
      </small>
      <span className="ws-sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
