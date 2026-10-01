import { useMemo, useState } from "react";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { getUiMessages, formatUiMessage } from "../../lib/i18n/catalog";
import { useLocale } from "../i18n/useLocale";
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
  localeContext?: LocaleContext;
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

function buildKeyFacts(device: DeviceLibraryEntry, text: ReturnType<typeof getUiMessages>["catalog"]) {
  return [
    device.price_label ? `${text.price} ${device.price_label}` : null,
    device.weight_label ? `${text.weight} ${device.weight_label}` : null,
    device.display_label ? `${text.display} ${device.display_label}` : null,
    device.fov_label ? `${text.fov} ${device.fov_label}` : null,
    device.platform_label ? `${text.platform} ${device.platform_label}` : null,
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

export default function DeviceLibraryExplorer({ devices, localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: Props) {
  const { context, messages } = useLocale(localeContext);
  const text = messages.catalog;
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
        setCompareMessage(text.deviceCompareLimit);
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
            {text.deviceSearch}
          </label>
          <input
            id="device-library-search"
            className="glass-input"
            type="search"
            placeholder={text.devicePlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="device-library-toolbar__filters">
          <label>
            <span>{text.category}</span>
            <select
              className="community-input"
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({ ...current, category: event.target.value as FilterState["category"] }))
              }
            >
              <option value="all">{text.allCategories}</option>
              {Object.entries(text.deviceCategory).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{text.brand}</span>
            <select
              className="community-input"
              value={filters.brand}
              onChange={(event) =>
                setFilters((current) => ({ ...current, brand: event.target.value as FilterState["brand"] }))
              }
            >
              <option value="all">{text.allBrands}</option>
              {brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{text.status}</span>
            <select
              className="community-input"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value as FilterState["status"] }))
              }
            >
              <option value="all">{text.allStatuses}</option>
              {Object.entries(text.deviceStatus).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{text.use}</span>
            <select
              className="community-input"
              value={filters.useCase}
              onChange={(event) =>
                setFilters((current) => ({ ...current, useCase: event.target.value as FilterState["useCase"] }))
              }
            >
              <option value="all">{text.allUses}</option>
              {Object.entries(text.deviceUses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="device-library-toolbar__footer">
          <div className="community-chip-row">
            {normalizedQuery ? <span className="community-chip">{text.search}: {query.trim()}</span> : null}
            {filters.category !== "all" ? <span className="community-chip">{text.deviceCategory[filters.category]}</span> : null}
            {filters.brand !== "all" ? <span className="community-chip">{filters.brand}</span> : null}
            {filters.status !== "all" ? <span className="community-chip">{text.deviceStatus[filters.status]}</span> : null}
            {filters.useCase !== "all" ? <span className="community-chip">{text.deviceUses[filters.useCase]}</span> : null}
          </div>

          <button type="button" className="community-button--secondary" onClick={clearFilters} disabled={activeFilterCount === 0}>
            {text.clearFilters}
          </button>
        </div>
      </section>

      <section className="community-surface community-surface--padded device-compare-tray">
        <div className="device-compare-tray__head">
          <div>
            <h2>{text.lightCompare}</h2>
            <p>{text.deviceCompareHint}</p>
          </div>
          <button
            type="button"
            className="community-button--secondary"
            onClick={clearComparison}
            disabled={selectedDevices.length === 0}
          >
            {text.clearCompare}
          </button>
        </div>

        <div className="device-compare-tray__chips">
          {selectedDevices.length > 0 ? (
            selectedDevices.map((device) => (
              <span key={device.slug} className="device-compare-pill">
                <span>{device.name}</span>
                <button type="button" aria-label={formatUiMessage(text.removeProduct, { name: device.name })} onClick={() => toggleCompare(device.slug)}>
                  {text.remove}
                </button>
              </span>
            ))
          ) : (
            <p className="device-compare-tray__empty">{text.noDevicesSelected}</p>
          )}
        </div>

        <p className="device-compare-tray__feedback" aria-live="polite">
          {compareMessage || (selectedDevices.length > 0 ? formatUiMessage(text.deviceSelected, { count: selectedDevices.length, max: maxCompareCount }) : "")}
        </p>
      </section>

      {selectedDevices.length > 0 ? (
        <section className="community-surface device-compare-panel">
          <div className="device-compare-panel__head">
            <h2>{text.comparePanel}</h2>
            <p>{text.highLevelCompare}</p>
          </div>

          <div className="device-compare-table-wrap">
            <table className="device-compare-table">
              <thead>
                <tr>
                  <th scope="col">{text.compareItem}</th>
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
                  <th scope="row">{text.category}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-category`}>{text.deviceCategory[device.category]}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.status}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-status`}>{text.deviceStatus[device.status]}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.use}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-use-cases`}>{device.use_cases.map((useCase) => text.deviceUses[useCase]).join(" / ")}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.price}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-price`}>{comparisonValue(device.price_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.weight}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-weight`}>{comparisonValue(device.weight_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.display}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-display`}>{comparisonValue(device.display_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.fov}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-fov`}>{comparisonValue(device.fov_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.platform}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-platform`}>{comparisonValue(device.platform_label)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{text.verification}</th>
                  {selectedDevices.map((device) => (
                    <td key={`${device.slug}-verification`}>{text.deviceVerification[device.verification_level ?? "unknown"]}</td>
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
            const keyFacts = buildKeyFacts(device, text);
            const isSelected = selectedSlugs.includes(device.slug);
            return (
              <article key={device.slug} className="device-library-card">
                <div className="device-library-card__head">
                  <div>
                    <p className="device-library-card__brand">{device.brand}</p>
                    <h2>{device.name}</h2>
                  </div>
                  <div className="device-library-card__badges">
                    <span className="community-chip">{text.deviceCategory[device.category]}</span>
                    <span className="community-chip">{text.deviceStatus[device.status]}</span>
                    <span className={`device-verification-badge ${verificationTone(device)}`}>
                      {text.deviceVerification[device.verification_level ?? "unknown"]}
                    </span>
                  </div>
                </div>

                <p className="device-library-card__summary">{device.short_description}</p>

                <div className="device-library-card__use-cases">
                  {device.use_cases.map((useCase) => (
                    <span key={useCase} className="community-chip">
                      {text.deviceUses[useCase]}
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
                  <p className="device-library-card__fallback">{text.hardwareLater}</p>
                )}

                <div className="device-library-card__actions">
                  <button
                    type="button"
                    className={`community-button--secondary device-library-card__compare ${isSelected ? "is-selected" : ""}`}
                    onClick={() => toggleCompare(device.slug)}
                  >
                    {isSelected ? text.added : text.joinCompare}
                  </button>
                  <a href={`/devices/${device.slug}/`} className="device-library-card__cta">
                    {text.viewDevice}
                  </a>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="community-empty device-library-empty">
          <strong>{text.noDevices}</strong>
          <p>{text.noDevicesHint}</p>
        </section>
      )}
    </div>
  );
}
