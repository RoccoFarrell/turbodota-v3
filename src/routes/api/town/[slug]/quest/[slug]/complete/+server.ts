import type { RequestHandler } from '@sveltejs/kit';
import { auth } from '$lib/server/lucia';
import prisma from '$lib/server/prisma';
import winOrLoss from '$lib/helpers/winOrLoss';
import dayjs from 'dayjs';
import type { Random } from '@prisma/client';

//constants
import {
	questWin_xpMultiplier,
	questWin_goldMultiplier,
	questLoss_goldMultiplier,
	questLoss_xpMultiplier,
	constant_spiritVesselMultiplier,
	constant_OrchidMultiplier,
	questWin_etherealBladeMultiplier,
	questLoss_etherealBladeMultiplier,
} from '$lib/constants/turbotown';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: Unreachable code error
BigInt.prototype.toJSON = function (): number {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore: Unreachable code error
	return this.toString();
};

export const POST: RequestHandler = async ({ request, params, url, locals, fetch }) => {
	const session = await locals.auth.validate();

	let requestData = await request.json();

	// console.log(
	// 	`[/quest/complete] session in API call: `,
	// 	JSON.stringify(session),
	// 	`params.slug: `,
	// 	params,
	// 	`request.url: `,
	// 	url
	// );
	//reject the call if the user is not authenticated

	let account_id: number = parseInt(url.pathname.split('/api/town/')[1].split('/quest')[0]);
	let questID: number = parseInt(params.slug || '0');

	console.log('[/quest/complete] account_id, questID: ', account_id, questID);
	if (session) {
		if (account_id !== session.user.account_id)
			return new Response(JSON.stringify({ status: 'unauthorized' }), { status: 401 });

		console.log(
			`\n-----------\n[api/town/${account_id}/quest/${questID}/complete] account_id: ${account_id}, questID: ${questID}\n-------------\n`
		);

		//console.log('[api/town/${account_id}/quest/${questID}/complete] requestData: ', requestData);

		console.log(`[api/town/${account_id}/quest/${questID}/complete] - checking random for: ${session.user.account_id}`);

		let randomStatusComplete: boolean = false;
		let completedRandom: Random | null = null;
		let xpItemMultiplier: number = 1;

		if (requestData.random.status === 'active') {
			const response = await fetch(
				`/api/players/${session.user.account_id}/randoms/${requestData.random.id}/complete`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ random: requestData.random })
				}
			);
			//console.log(`[api/town/${account_id}/quest/${questID}/complete] check random response: `, response);

			let responseData = await response.json();
			if (responseData.success) {
				randomStatusComplete = true;
				completedRandom = responseData.randomCompleteResults;
			}
		} else {
			if (requestData.random.status === 'completed') {
				randomStatusComplete = true;
				completedRandom = requestData.random;
			}
		}

		if (randomStatusComplete) {
			console.log('random was completed, time to complete quest');

			const tx_result = await prisma.$transaction(
				async (tx) => {
					let tx_startTime = dayjs()
					const quest = await tx.turbotownQuest.findFirst({
						where: {
							AND: [{ id: questID }, { status: 'active' }]
						}
					});

					//console.log('quest: ', quest);
					//console.log('completedRandom: ', completedRandom);

					//check for gold modifiers i.e. Spirit Vessel
					console.log(`[api/town/${account_id}/quest/${questID}/complete] - checking for debuffs`);

					//get the turbotownID
					const statusResult = await prisma.turbotown.findFirst({
						where: {
							account_id
						},
					})

					if (quest && completedRandom) {

						//find the active status to clear
						if (statusResult) {
							const modifierCheck = await prisma.turbotownStatus.findMany({
								where: {
									AND: [
										{
											turbotownID: statusResult.id,
											isActive: true,
											OR: [
												{ name: "spirit vessel" },
												{ name: "orchid" },
												{ name: "ethereal blade"},
											]
										}
									]
								}
							})

							//set the modifier and remove the debuff from the town
							for (const buffDebuff of modifierCheck) {
								if (buffDebuff.name === 'spirit vessel') {
									xpItemMultiplier = xpItemMultiplier * constant_spiritVesselMultiplier
								}
								else if (buffDebuff.name === 'orchid') {
									xpItemMultiplier = xpItemMultiplier * constant_OrchidMultiplier
								}
								else if (buffDebuff.name === 'ethereal blade') {
									completedRandom.win
										? xpItemMultiplier = xpItemMultiplier * questWin_etherealBladeMultiplier
										: xpItemMultiplier = xpItemMultiplier * questLoss_etherealBladeMultiplier
									
								}
								const statusUpdateResult = await tx.turbotownStatus.update({
									where: {
										id: buffDebuff.id
									},
									data: {
										isActive: false,
										resolvedDate: new Date()
									}
								});
								if (!statusUpdateResult) {
									throw new Error(`${session.user.account_id} failed to update status`);
								}
							}

						}

						const townQuestUpdateResult = await tx.turbotown.update({
							where: {
								account_id
							},
							data: {
								quests: {
									update: {
										where: {
											id: questID
										},
										data: {
											active: false,
											status: 'completed',
											win: completedRandom.win ? true : false,
											endDate: dayjs().toDate(),
											endXp: (completedRandom.win ? quest.xp * questWin_xpMultiplier : quest.xp * questLoss_xpMultiplier) * xpItemMultiplier,
											endGold: completedRandom.win
												? quest.gold * questWin_goldMultiplier
												: quest.gold * questLoss_goldMultiplier
										}
									}
								}
							},
							include: {
								metrics: true,
								quests: {
									orderBy: {
										endDate: 'asc'
									}
								}
							}
						});

						//console.log('townQuestUpdateResult: ', townQuestUpdateResult);

						let metrics_gold = townQuestUpdateResult.metrics.filter((metric) => metric.label === 'gold')[0];
						let metrics_xp = townQuestUpdateResult.metrics.filter((metric) => metric.label === 'xp')[0];
						let completedQuest = townQuestUpdateResult.quests.filter((quest) => quest.id === questID)[0];

						if (
							(completedQuest.endGold || completedQuest.endGold === 0) &&
							(completedQuest.endXp || completedQuest.endXp === 0)
						) {
							const townGoldUpdateResult = await tx.turbotown.update({
								where: {
									account_id
								},
								data: {
									metrics: {
										update: {
											where: {
												id: metrics_gold.id
											},
											data: {
												value: metrics_gold.value + completedQuest.endGold
											}
										}
									}
								}
							});

							const townXPUpdateResult = await tx.turbotown.update({
								where: {
									account_id
								},
								data: {
									metrics: {
										update: {
											where: {
												id: metrics_xp.id
											},
											data: {
												value: metrics_xp.value + completedQuest.endXp
											}
										}
									}
								},
								include: {
									metrics: true,
									quests: true
								}
							});

							let tx_endTime = dayjs()
							let executionTime = tx_endTime.diff(tx_startTime, 'millisecond')
							console.log(`[/quest/complete] execution time: ${executionTime}`)
							return { town: townXPUpdateResult, quest, executionTime };
						} else {
							let newResponse = new Response(
								JSON.stringify({ status: 'fail', message: 'no endXp or endGold', success: false })
							);
							return newResponse;
						}
					} else {
						let newResponse = new Response(
							JSON.stringify({ status: 'fail', message: 'no quest or completedRandom', success: false })
						);
						return newResponse;
					}
				},
				{
					maxWait: 9500, // default: 2000
					timeout: 9500 // default: 5000
				}
			);

			if (tx_result) {
				//if (tx_result.town) console.log('added gold and xp to town', tx_result.town.id, tx_result.town.metrics);
				let newResponse = new Response(JSON.stringify({ status: 'success', success: true, tx_result }));
				return newResponse;
			} else {
				let newResponse = new Response(JSON.stringify({ status: 'fail', message: 'no tx_result', success: false }));
				return newResponse;
			}
		} else {
			let newResponse = new Response(
				JSON.stringify({
					status: 'fail',
					message: 'random was not completed',
					success: false,
					random: requestData.random,
					questID
				})
			);
			return newResponse;
		}
	}

	let newResponse = new Response(JSON.stringify({ status: 'fail', message: 'couldnt update town', success: false }));
	return newResponse;
};
