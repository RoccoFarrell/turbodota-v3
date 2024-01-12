import type { RequestHandler } from '@sveltejs/kit';
import { auth } from '$lib/server/lucia';
import prisma from '$lib/server/prisma';

//constants
import { constant_questGold, constant_questXP } from '$lib/constants/turbotown';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: Unreachable code error
BigInt.prototype.toJSON = function (): number {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore: Unreachable code error
	return this.toString();
};

export const POST: RequestHandler = async ({ request, params, url, locals }) => {
	const session = await locals.auth.validate();

	console.log(
		`[/api/random/${params.slug}/create] session in API call: `,
		JSON.stringify(session),
		`params.slug: `,
		params.slug
	);
	//reject the call if the user is not authenticated

	let randomCreateResult;

	if (session && session.user) {
		if (params.slug?.toString() !== session.user.account_id.toString())
			return new Response(JSON.stringify({ status: 'unauthorized' }), { status: 401 });

		console.log(`params: ${JSON.stringify(params)}`);

		let account_id: number = parseInt(params.slug || '0');
		console.log(`\n-----------\n[matches] account_id: ${account_id}\n-------------\n`);

		let randomStoreValues = await request.json();
		//console.log('request json: ', randomStoreValues);

		console.log(`[api/random/${account_id}/create] creating random for: ${randomStoreValues.randomedHero}`);

		//check if user was updated recently, otherwise use the database
		const userResult = await prisma.dotaUser.findUnique({
			where: {
				account_id
			},
			include: {
				seasons: {
					where: {
						active: true
					},
					include: {
						turbotowns: {
							where: { account_id: account_id }
						}
					}
				}
			}
		});

		let season = null;
		if (userResult && userResult.seasons) {
			let randomSeasonIndex = userResult.seasons.findIndex((season) => season.type === 'random' && season.active);
			if (randomSeasonIndex !== -1) {
				season = userResult.seasons[randomSeasonIndex]
			} else {
				console.warn('randomSeasonIndex was -1');
			}
		}

		if (season && season.turbotowns.length > 0) {
			randomCreateResult = await prisma.random.create({
				data: {
					account_id: session.user.account_id,
					active: true,
					status: 'active',
					date: new Date(),
					availableHeroes: randomStoreValues.availableHeroes.toString(),
					bannedHeroes: randomStoreValues.bannedHeroes.toString(),
					selectedRoles: randomStoreValues.selectedRoles.toString(),
					expectedGold: randomStoreValues.expectedGold,
					modifierAmount: randomStoreValues.modifierAmount,
					modifierTotal: randomStoreValues.modifierTotal,
					randomedHero: randomStoreValues.randomedHero,
					seasons: {
						connect: { id: season.id }
					},
					quests: {
						create: {
							turbotownID: season.turbotowns[0].id,
                            questSlot: randomStoreValues.questSlot,
                            type: "random",
                            active: true,
                            status: "active",
                            xp: constant_questXP,
                            gold: constant_questGold
						}
					}
				}
			});
		} else {
			randomCreateResult = await prisma.random.create({
				data: {
					account_id: session.user.account_id,
					active: true,
					status: 'active',
					date: new Date(),
					availableHeroes: randomStoreValues.availableHeroes.toString(),
					bannedHeroes: randomStoreValues.bannedHeroes.toString(),
					selectedRoles: randomStoreValues.selectedRoles.toString(),
					expectedGold: randomStoreValues.expectedGold,
					modifierAmount: randomStoreValues.modifierAmount,
					modifierTotal: randomStoreValues.modifierTotal,
					randomedHero: randomStoreValues.randomedHero
				}
			});
		}
	} else {
		return new Response(JSON.stringify({ status: 'unauthorized to create random for this user' }), { status: 401 });
	}

	let newResponse = new Response(JSON.stringify({ status: 'success', insert: randomCreateResult }));
	return newResponse;
};
