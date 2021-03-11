'use strict';
const _ = require('lodash');
const emojiRegex = require("emoji-regex");

module.exports = (Model, options) => {
    let fields = options.fields || ['name'];
    const stripEmojis = options.stripEmojis;
    if (_.isString(fields)) {
        fields = [fields];
    }
    Model.defineProperty('slug', { type: String, index:{ unique:true } });
    Model.observe('access', function (ctx, next) {
        if (ctx.query.where && ctx.query.where.id) {
            let id = ctx.query.where.id;
            if(id.toString() && id.toString() !== '[object Object]'){
                id = id.toString()
            }
            ctx.query.where.or = [{
                id
            }, {
                slug: id
            }];
            ctx.query.where = _.omit(ctx.query.where, ['id']);
        }
        next();
    });

    Model.validateSlug = (slug) => {
        if(!slug) return Promise.reject(`Slug is required.`);
        return /^[a-zA-Z0-9]+([a-zA-Z0-9_-])*$/.test(slug);
    }

    const stripEmojisFn = (name) =>{
        if(!stripEmojis) return name;
        return name.replace(emojiRegex(),'').trim();
    }

    Model.getBaseSlug = (instance) => {
        
        let slug = _.snakeCase(_.trim(_.join(_.filter(_.map(fields, field => stripEmojisFn(instance[field]))), '_')));
        slug = slug === '_' ? '0' : slug;
        slug = slug.replace(/_/g, '-');
        return slug;
    }

    Model.findUniqueSlug = async (instance) => {
        let baseSlug = Model.getBaseSlug(instance);
        let regex = baseSlug === '0' ? new RegExp(`^([0-9]+)$`) : new RegExp(`^${baseSlug}(-[0-9]+){0,1}$`);
        let similarInstances = await Model.find({
            where: {
                slug: {
                    like: regex
                }
            }
        });
        if (!similarInstances.length) {
            return baseSlug;
        }
        
        let maxCount = 0;
        const slugMap = {};
        _.forEach(similarInstances, similarInstance => {
            let match = similarInstance.slug.match(regex), count = 0;
            if (match[1]) {
                count = parseInt(match[1].replace('-', ''));
            }
            if (count > maxCount) {
                maxCount = count;
            }
            slugMap[similarInstance.slug] = {
                id: similarInstance.id.toString(),
                slug: similarInstance.slug
            };
        });

        if(!slugMap[baseSlug]) return baseSlug;

        let leastFreeSlugCount = 0;
        for(let i = 0; i <= maxCount + 1; i++){
            let _slug = i? `-${i}` : '';
            let slugMapVal = slugMap[baseSlug + _slug];
            if(slugMapVal){
                if(slugMapVal.id.toString() === (instance.id || '').toString()){
                    return slugMapVal.slug;
                }
                continue;
            }
            leastFreeSlugCount = i;
            break;
        }

        let slugSuffix = leastFreeSlugCount? `-${leastFreeSlugCount}` : '';
        
        let instanceSlug = baseSlug + slugSuffix;
          
        return instanceSlug;
    }

    Model.observe('before save', async (ctx) => {
        var instance = ctx.instance || ctx.data;
        let where = {};
        if (instance.id) {
            where.id = instance.id;
        }
        else {
            where = ctx.where;
        }
        if(instance.slug){
            await Model.validateSlug(instance.slug)
        }
        let createNewSlug = false;
        if (!ctx.isNewInstance) {
            let prevInstance = await Model.findOne({ where });
            createNewSlug = !prevInstance.slug && !instance.slug;
        }
        else {
            createNewSlug = !instance.slug;
        }
        if (createNewSlug) {
            instance.slug = await Model.findUniqueSlug(instance);
        }
    });

    Model.updateSlug = async () => {
        let instances = await Model.find({
            where: {
                or: [
                    { slug: { exists: false } },
                    { slug: "" },
                    { slug: null }
                ]
            }
        });
        for (let i = 0; i < instances.length; i++) {
            let instance = instances[i];
            let slug = await Model.findUniqueSlug(instance);
            await instance.updateAttributes({ slug });
        }
    }
    setTimeout(Model.updateSlug, 5000);
}

