import type { Actions, PageServerLoad } from './$types'
import { client } from '$lib/server/prisma'
import { error, fail, redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async () => {
	return {
		articles: await client.article.findMany()
	}
}

export const actions: Actions = {
	createArticle: async ({ request, locals }) => {
		const session = await locals.auth.validate()
		console.log(session)
		const user = session.user
		if (!session || !user) {
			throw redirect(302, '/')
		}

		const { title, content } = Object.fromEntries(await request.formData()) as Record<
			string,
			string
		>

		try {
			await client.article.create({
				data: {
					title,
					content,
					userId: user.userId
				}
			})
		} catch (err) {
			console.error(err)
			return fail(500, { message: 'Could not create the article.' })
		}

		return {
			status: 201
		}
	},
	deleteArticle: async ({ url, locals }) => {
		const session = await locals.auth.validate()
		const user = session.user
		if (!session) {
			throw redirect(302, '/')
		}
		const id = url.searchParams.get('id')
		if (!id) {
			return fail(400, { message: 'Invalid request' })
		}

		try {
			const article = await client.article.findUniqueOrThrow({
				where: {
					id: Number(id)
				}
			})

			if (article.userId !== user.userId) {
				throw error(403, 'Not authorized')
			}

			await client.article.delete({
				where: {
					id: Number(id)
				}
			})
		} catch (err) {
			console.error(err)
			return fail(500, {
				message: 'Something went wrong deleting your article'
			})
		}

		return {
			status: 200
		}
	}
}
