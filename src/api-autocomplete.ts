type Choice = { name: string; value: string; };
type MemberDoc = { children?: { name: string; description?: string; }[]; };

const cache = new Map<string, { expires: number; data: unknown; }>();

async function getDoc<T>(
    path: string,
    version: string,
    signal: AbortSignal,
): Promise<T> {
    const url = `https://${version === "v4000" ? "v4000." : ""
        }kaplayjs.com/api/doc/${path}.json`;
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.data as T;
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Documentation request failed: ${response.status}`);
    }
    const data = await response.json();
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(url, { expires: Date.now() + 300_000, data });
    return data as T;
}

export async function getApiQueryChoices(
    query: string,
    version: string,
): Promise<Choice[]> {
    version = version.toLowerCase();
    if (version !== "v3001" && version !== "v4000") return [];

    const signal = AbortSignal.timeout(2000);
    const names = await getDoc<string[]>("names", version, signal);
    const search = query.trim().toLowerCase();
    const dot = search.indexOf(".");
    let candidates: Choice[];

    if (dot >= 0 && !search.startsWith("ctx.")) {
        const parent = names.find((name) =>
            name.toLowerCase() === search.slice(0, dot)
        );
        if (!parent) return [];
        const docs = await getDoc<MemberDoc[]>(
            encodeURIComponent(parent),
            version,
            signal,
        );
        candidates = docs.flatMap((entry) =>
            (entry.children ?? []).map((child) => {
                const value = `${parent}.${child.name}`;
                const description = child.description?.replace(/\s+/g, " ")
                    .trim();
                return {
                    name: description ? `${value} ㆍ ${description}` : value,
                    value,
                };
            })
        );
    }
    else {
        candidates = names.map((name) => ({ name, value: name }));
    }

    const normalized = (choice: Choice) => {
        const value = choice.value.toLowerCase();
        return search.startsWith("ctx.") ? value : value.replace(/^ctx\./, "");
    };

    return [
        ...new Map(candidates.map((choice) => [choice.value, choice])).values(),
    ]
        .filter((choice) =>
            choice.value.length <= 100 && normalized(choice).includes(search)
        )
        .sort((a, b) =>
            Number(normalized(b).startsWith(search))
            - Number(normalized(a).startsWith(search))
            || a.value.localeCompare(b.value)
        )
        .slice(0, 25)
        .map((choice) => ({ ...choice, name: choice.name.slice(0, 100) }));
}
