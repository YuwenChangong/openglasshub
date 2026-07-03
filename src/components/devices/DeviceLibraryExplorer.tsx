import { useDeferredValue, useMemo, useState } from "react";
import {
  deviceCategoryLabels,
  deviceStatusLabels,
  deviceUseCaseLabels,
  type DeviceCategory,
  type DeviceLibraryEntry,
  type DeviceStatus,
  type DeviceUseCase,
} from "../../data/devices";

type Props = {
  devices: DeviceLibraryEntry[];
};

type FilterState = {
  category: "all" | DeviceCategory;
  brand: "all" | string;
  status: "all" | DeviceStatus;
  useCase: "all" | DeviceUseCase;
};

const initialFilters: FilterState = {
  category: "all",
  brand: "all",
  status: "all",
  useCase: "all",
};

function matchesQuery(device: DeviceLibraryEntry, query: string) {
  if (!query) return true;
  const haystack = [
    device.name,
    device.brand,
    device.short_description,
    device.platform_label ?? "",
    device.display_label ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function buildKeyFacts(device: DeviceLibraryEntry) {
  return [
    device.price_label ? `价格 ${device.price_label}` : null,
    device.weight_label ? `重量 ${device.weight_label}` : null,
    device.display_label ? `显示 ${device.display_label}` : null,
    device.fov_label ? `视场 ${device.fov_label}` : null,
    device.platform_label ? `平台 ${device.platform_label}` : null,
  ].filter(Boolean) as string[];
}

export default function DeviceLibraryExplorer({ devices }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const brands = useMemo(
    () => Array.from(new Set(devices.map((device) => device.brand))).sort((left, right) => left.localeCompare(right)),
    [devices],
  );

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      if (filters.category !== "all" && device.category !== filters.category) return false;
      if (filters.brand !== "all" && device.brand !== filters.brand) return false;
      if (filters.status !== "all" && device.status !== filters.status) return false;
      if (filters.useCase !== "all" && !device.use_cases.includes(filters.useCase)) return false;
      if (!matchesQuery(device, deferredQuery)) return false;
      return true;
    });
  }, [deferredQuery, devices, filters]);

  const activeFilterCount =
    Number(filters.category !== "all") +
    Number(filters.brand !== "all") +
    Number(filters.status !== "all") +
    Number(filters.useCase !== "all") +
    Number(deferredQuery.length > 0);

  return (
    <div className="device-library">
      <section className="community-surface device-library-toolbar">
        <div className="device-library-toolbar__search">
          <label className="device-library-toolbar__label" htmlFor="device-library-search">
            搜索设备
          </label>
          <input
            id="device-library-search"
            className="glass-input"
            type="search"
            placeholder="按名称、品牌或用途搜索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="device-library-toolbar__filters">
          <label>
            <span>分类</span>
            <select
              className="community-input"
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({ ...current, category: event.target.value as FilterState["category"] }))
              }
            >
              <option value="all">全部分类</option>
              {Object.entries(deviceCategoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>品牌</span>
            <select
              className="community-input"
              value={filters.brand}
              onChange={(event) =>
                setFilters((current) => ({ ...current, brand: event.target.value as FilterState["brand"] }))
              }
            >
              <option value="all">全部品牌</option>
              {brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>状态</span>
            <select
              className="community-input"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value as FilterState["status"] }))
              }
            >
              <option value="all">全部状态</option>
              {Object.entries(deviceStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>用途</span>
            <select
              className="community-input"
              value={filters.useCase}
              onChange={(event) =>
                setFilters((current) => ({ ...current, useCase: event.target.value as FilterState["useCase"] }))
              }
            >
              <option value="all">全部用途</option>
              {Object.entries(deviceUseCaseLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="device-library-toolbar__footer">
          <div className="community-chip-row">
            {deferredQuery ? <span className="community-chip">搜索: {query.trim()}</span> : null}
            {filters.category !== "all" ? <span className="community-chip">{deviceCategoryLabels[filters.category]}</span> : null}
            {filters.brand !== "all" ? <span className="community-chip">{filters.brand}</span> : null}
            {filters.status !== "all" ? <span className="community-chip">{deviceStatusLabels[filters.status]}</span> : null}
            {filters.useCase !== "all" ? <span className="community-chip">{deviceUseCaseLabels[filters.useCase]}</span> : null}
          </div>

          <button
            type="button"
            className="community-button--secondary"
            onClick={() => {
              setQuery("");
              setFilters(initialFilters);
            }}
            disabled={activeFilterCount === 0}
          >
            清除筛选
          </button>
        </div>
      </section>

      {filteredDevices.length > 0 ? (
        <section className="device-library-grid" aria-live="polite">
          {filteredDevices.map((device) => {
            const keyFacts = buildKeyFacts(device);
            return (
              <a key={device.slug} href={`/devices/${device.slug}/`} className="device-library-card">
                <div className="device-library-card__head">
                  <div>
                    <p className="device-library-card__brand">{device.brand}</p>
                    <h2>{device.name}</h2>
                  </div>
                  <div className="device-library-card__badges">
                    <span className="community-chip">{deviceCategoryLabels[device.category]}</span>
                    <span className="community-chip">{deviceStatusLabels[device.status]}</span>
                  </div>
                </div>

                <p className="device-library-card__summary">{device.short_description}</p>

                <div className="device-library-card__use-cases">
                  {device.use_cases.map((useCase) => (
                    <span key={useCase} className="community-chip">
                      {deviceUseCaseLabels[useCase]}
                    </span>
                  ))}
                </div>

                {keyFacts.length > 0 ? (
                  <ul className="device-library-card__facts">
                    {keyFacts.slice(0, 4).map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="device-library-card__fallback">详细硬件信息将在后续带来源说明的版本补齐。</p>
                )}

                <span className="device-library-card__cta">查看设备页</span>
              </a>
            );
          })}
        </section>
      ) : (
        <section className="community-empty device-library-empty">
          <strong>没有找到匹配设备</strong>
          <p>试试清除筛选，或用更宽泛的品牌、分类和用途关键词重新搜索。</p>
        </section>
      )}
    </div>
  );
}
