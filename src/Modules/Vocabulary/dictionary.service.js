const lookup = require('./vocabulary.lookup');

const providers = {
    dictionaryapi: {
        name: 'DictionaryAPI',
        license: 'Provider license must be verified before redistribution',
        url: 'https://dictionaryapi.dev/'
    },
    wiktionary: {
        name: 'Wiktionary REST',
        license: 'CC BY-SA 3.0 (Wiktionary; verify content-by-content attribution requirements)',
        url: 'https://en.wiktionary.org/'
    }
};

const lookupWord = async word => {
    const result = await lookup.lookupWord(word);
    return {
        ...result,
        Source: {
            Provider: result.Senses?.length ? providers.dictionaryapi.name : providers.wiktionary.name,
            URL: providers.dictionaryapi.url,
            License: providers.dictionaryapi.license,
            Attribution: 'Content normalized by the IELTS Vocabulary system'
        },
        IPAUK: result.Pronunciation || '',
        IPAUS: result.Pronunciation || '',
        AudioUK: '',
        AudioUS: '',
        DictionaryStatus: result.Senses?.some(sense => !sense.Meaning) ? 'partial' : 'verified'
    };
};

module.exports = {
    lookupWord,
    providers
};
