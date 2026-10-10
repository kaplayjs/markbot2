export const apiUrl =
    "https://api.thecatapi.com/v1/images/search?mime_types=gif";

export async function getCuteCatUrl() {
    const response = await fetch(apiUrl);

    if (!response.ok) {
        let errorText =
            `Error fetching ${response.url}: ${response.status} ${response.statusText}`;
        try {
            const error = await response.text();
            if (error) {
                errorText = `${errorText} \n\n ${error}`;
            }
        } catch {
            // ignore
        }
        throw new Error(errorText);
    }

    const data: unknown = await response.json();
    const firstImage: unknown = Array.isArray(data) ? data[0] : undefined;

    if (
        typeof firstImage !== "object" || firstImage === null
        || !("url" in firstImage) || typeof firstImage.url !== "string"
    ) {
        throw new Error("Cat API returned no image URL.");
    }

    return firstImage.url;
}
