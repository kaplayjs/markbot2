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

    const data = await response.json();
    return data[0].url;
}
