import { useMemo, useState } from "react";
import {
  deviceCategoryLabels,
  deviceStatusLabels,
  deviceUseCaseLabels,
  deviceVerificationLabels,
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

const maxCompareCount = 3;

function matchesQuery(device: DeviceLibraryEntry, query: string) {
  if (!query) return true;
  const haystack = [
    device.name,
    device.brand,
    device.short_description,
    device.platform_label ?? "",
    device.display_label ?? "",
    ...(device.comparison_highlights ?? []),
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

function comparisonValue(value?: string) {
  return value?.trim() ? value : "TBD";
}

function verificationTone(device: DeviceLibraryEntry) {
  switch (device.verification_level) {
    case "official":
      return "is-official";
    case "retailer":
      return "is-retailer";
    case "community":
    case "estimated":
      return "is-community";
    default:
      return "is-unknown";
  }
}

export default function DeviceLibraryExplorer({ devices }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [compareMessage, setCompareMessage] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

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
      if (!matchesQuery(device, normalizedQuery)) return false;
      return true;
    });
  }, [devices, filters, normalizedQuery]);

  const selectedDevices = useMemo(
    () =>
      selectedSlugs
        .map((slug) => devices.find((device) => device.slug === slug))
        .filter((device): device is DeviceLibraryEntry => Boolean(device)),
    [devices, selectedSlugs],
  );

  const activeFilterCount =
    Number(filters.category !== "all") +
    Number(filters.brand !== "all") +
    Number(filters.status !== "all") +
    Number(filters.useCase !== "all") +
    Number(normalizedQuery.length > 0);

  function clearFilters() {
    setQuery("");
    setFilters(initialFilters);
  }

  function clearComparison() {
    setSelectedSlugs([]);
    setCompareMessage("");
  }

  function toggleCompare(slug: string) {
    setSelectedSlugs((current) => {
      if (current.includes(slug)) {
        setCompareMessage("");
        return current.filter((value) => value !== slug);
      }
      if (current.length >= maxCompareCount) {
        setCompareMessage("对比栏最多保留 3 台设备，请先移除一台再继续。");
        return current;
      }
      setCompareMessage("");
      return [...current, slug];
    });
  }

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
            {normalizedQuery ? <span className="community-chip">搜索: {query.trim()}</span> : null}
            {filters.category !== "all" ? <span className="community-chip">{deviceCategoryLabels[filters.category]}</span> : null}
            {filters.brand !== "all" ? <span className="community-chip">{filters.brand}</span> : null}
            {filters.status !== "all" ? <span className="community-chip">{deviceStatusLabels[filters.status]}</span> : null}
            {filters.useCase !== "all" ? <span className="community-chip">{deviceUseCaseLabels[filters.useCase]}</span> : null}
          </div>

          <button type="button" className="community-button--secondary" onClick={clearFilters} disabled={activeFilterCount === 0}>
            清除筛选
          </button>
        </div>
      </section>

      <section className="community-surface community-surface--padded device-compare-tray">
        <div className="device-compare-tray__head">
          <div>
            <h2>轻量对比</h2>
            <p>最多选择 3 台设备。缺失字段会显示为 TBD 或 Not verified。</p>
          </div>
          <button
            type="button"
            className="community-button--secondary"
            onClick={clearComparison}
            disabled={selectedDevices.length === 0}
          >
            清空对比
          </button>
        </div>

        <div className="device-compare-tray__chips">
          {selectedDevices.length > 0 ? (
            selectedDevices.map((device) => (
              <span key={device.slug} className="device-compare-pill">
                <span>{device.name}</span>
                <button type="button" aria-label={`移除 ${device.name}`} onClick={() => toggleCompare(device.slug)}>
                  移除
                </button>
              </span>
            ))
          ) : (
            <p className="device-compare-tray__empty">还没有选择设备。先从下面的卡片里加入 2 到 3 台设备。</p>
          )}
        </div>

        <p className="device-compare-tray__feedback" aria-live="polite">
          {compareMessage || (selectedDevices.length > 0 ? `已选择 ${selectedDevices.length} / ${maxCompareCount} 台设备用于比较。` : "")}
        </p>
      </section>

      {selectedDevices.length > 0 ? (
        <section className="community-surface device-compare-panel">
          <div className="device-compare-panel__head">
            <h2>对比面板</h2>
            <p>这是一张高层比较表，只帮助判断方向，不代表完整或最终规格。</p>
          </div>

          <div className="device-compare-table-wrap">
            <table className="device-compare-table">
              <thead>
                <tr>
                  <th scope="col">对比项</th>
                  {selectedDevices.map((device) => (
                    <th key={device.slug} scope="col">
                      <div className="device-compare-table__device">
                        <strong>{device.name}</strong>
                        <span>{device.brand}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">分类</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-category`}>{deviceCategoryLabels[device.category]}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">状态</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-status`}>{deviceStatusLabels[device.status]}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">用途</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-use-cases`}>{device.use_cases.map((useCase) => deviceUseCaseLabels[useCase]).join(" / ")}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">价格</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-price`}>{comparisonValue(device.price_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">重量</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-weight`}>{comparisonValue(device.weight_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">显示</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-display`}>{comparisonValue(device.display_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">视场</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-fov`}>{comparisonValue(device.fov_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">平台</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-platform`}>{comparisonValue(device.platform_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">核验级别</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-verification`}>{deviceVerificationLabels[device.verification_level ?? "unknown"]}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {filteredDevices.length > 0 ? (
        <section className="device-library-grid" aria-live="polite">
          {filteredDevices.map((device) => {
            const keyFacts = buildKeyFacts(device);
            const isSelected = selectedSlugs.includes(device.slug);
            return (
              <article key={device.slug} className="device-library-card">
                <div className="device-library-card__head">
                  <div>
                    <p className="device-library-card__brand">{device.brand}</p>
                    <h2>{device.name}</h2>
                  </div>
                  <div className="device-library-card__badges">
                    <span className="community-chip">{deviceCategoryLabels[device.category]}</span>
                    <span className="community-chip">{deviceStatusLabels[device.status]}</span>
                    <span className={`device-verification-badge ${verificationTone(device)}`}>
                      {deviceVerificationLabels[device.verification_level ?? "unknown"]}
                    </span>
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

                {device.comparison_highlights?.length ? (
                  <ul className="device-library-card__highlights">
                    {device.comparison_highlights.slice(0, 2).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}

                {keyFacts.length > 0 ? (
                  <ul className="device-library-card__facts">
                    {keyFacts.slice(0, 4).map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="device-library-card__fallback">详细硬件信息将在后续带来源说明的版本补齐。</p>
                )}

                <div className="device-library-card__actions">
                  <button
                    type="button"
                    className={`community-button--secondary device-library-card__compare ${isSelected ? "is-selected" : ""}`}
                    onClick={() => toggleCompare(device.slug)}
                  >
                    {isSelected ? "已加入对比" : "加入对比"}
                  </button>
                  <a href={`/devices/${device.slug}/`} className="device-library-card__cta">
                    查看设备页
                  </a>
                </div>
              </article>
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
