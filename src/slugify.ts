export class Slug {
	public constructor(
		public readonly value: string
	) { }

	public equals(other: Slug): boolean {
		return this.value === other.value;
	}
}

export interface Slugifier {
	fromHeading(heading: string): Slug;
	fromFragment(fragment: string): Slug;
	fromHeadingNoEncoding(heading: string): string;
}

export const githubSlugifier: Slugifier = new class implements Slugifier {
	fromHeading(heading: string): Slug {
		const slugifiedHeading = encodeURI(
			this.fromHeadingNoEncoding(heading)
		);
		return new Slug(slugifiedHeading);
	}

	fromFragment(fragment: string): Slug {
		return new Slug(encodeURI(fragment));
	}

	fromHeadingNoEncoding(heading: string) {
		return heading.trim()
			.toLowerCase()
			.replace(/\s+/g, '-') // Replace whitespace with -
			// allow-any-unicode-next-line
			.replace(/[\]\[\!\'\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\_\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
			.replace(/^\-+/, '') // Remove leading -
			.replace(/\-+$/, '') // Remove trailing -
		;
	}
};
