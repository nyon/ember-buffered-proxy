import Ember from 'ember';
import {
  aliasMethod,
  empty
} from './helpers';

const {
  get,
  set,
  isArray,
  computed,
  getProperties,
  defineProperty,
  meta,
} = Ember;

let BufferedProxy;

const keys = Object.keys || Ember.keys;
const create = Object.create || Ember.create;
const hasOwnProp = Object.prototype.hasOwnProperty;
const isComputedProperty = obj => {
  return obj._dependentKeys && obj._dependentKeys.length;
};
const isProxy = (e) => Ember.typeOf(e) === 'instance' && e.get('content') !== undefined;
const needsProxy = (e) => Ember.typeOf(e) === 'instance' || Ember.typeOf(e) === 'object';

const tryApplyBufferedChanges = obj => {
  if(obj.applyBufferedChanges && obj.get('content')) {
    obj.applyBufferedChanges();
  }
};

const proxify = (e) => {
  // Is value a proxy?
  if(isProxy(e) || !needsProxy(e)) {
    return e;
  }
  return Ember.ObjectProxy.extend(BufferedProxy).create({
    content: e
  });
};


BufferedProxy = Ember.Mixin.create({
  buffer: null,
  hasBufferedChanges: false,

  hasChanges: computed.readOnly('hasBufferedChanges'),
  applyChanges: aliasMethod('applyBufferedChanges'),
  discardChanges : aliasMethod('discardBufferedChanges'),

  init() {
    this.initializeBuffer();
    set(this, 'hasBufferedChanges', false);
    this._super(...arguments);
  },

  initializeBuffer(onlyTheseKeys) {
    if(isArray(onlyTheseKeys) && !empty(onlyTheseKeys)) {
      onlyTheseKeys.forEach((key) => delete this.buffer[key]);
    }
    else {
      set(this, 'buffer', create(null));
    }
  },



  // 1. Has the queried key already been saved to buffer? then return value
  // 2. If not:
  //   a) is the queried key a computed property? transfer it to this buffer
  //      computed property must not be saved as values directly
  //   b) else proxify value of content object and return new proxy

  unknownProperty(key) {
    const buffer = get(this, 'buffer');

    if(!hasOwnProp.call(buffer, key)) {
      let rawUnresolvedObject = this.get('content')[key];
      if(!rawUnresolvedObject) {
        return rawUnresolvedObject;
      }
      if(isComputedProperty(rawUnresolvedObject)) {
        Ember.defineProperty(this, key, rawUnresolvedObject);
        return this.get(key);
      }
      let unresolvedObject = this.get(`content.${key}`);
      return this._handleProperty(key, unresolvedObject);
    }
    return buffer[key];
  },

  setUnknownProperty(key, value) {
    const m = meta(this);

    if (m.proto === this) {
      // if marked as prototype then just defineProperty
      // rather than delegate
      defineProperty(this, key, null, value);
      return value;
    }

    const { buffer, content } = getProperties(this, ['buffer', 'content']);
    let current;
    let previous;

    if (content != null) {
      current = get(content, key);
    }

    previous = hasOwnProp.call(buffer, key) ? buffer[key] : current;

    if (previous === value) {
      return;
    }

    this.propertyWillChange(key);

    if (current === value) {
      delete buffer[key];
      if (empty(buffer)) {
        set(this, 'hasBufferedChanges', false);
      }
    } else {
      buffer[key] = value;
      set(this, 'hasBufferedChanges', true);
    }

    this.propertyDidChange(key);

    return value;
  },


  applyBufferedChanges(onlyTheseKeys) {
    const { buffer, content } = getProperties(this, ['buffer', 'content']);

    keys(buffer).forEach((key) => {
      if (isArray(onlyTheseKeys) && onlyTheseKeys.indexOf(key) === -1) {
        return;
      }

      let obj = buffer[key];
      let type = Ember.typeOf(obj);
      if(type === 'instance' || type === 'object') {
        if(isArray(obj)) {
          obj.forEach(tryApplyBufferedChanges);
          let objs = obj.get('content') || obj;
          Ember.set(content, key, objs.map(function(e) {
            return e.get('content') || e;
          }));
        } else {
          tryApplyBufferedChanges(obj);
          if(obj.toString().indexOf('model') === -1) { // TODO: generalize it...
            Ember.set(content, key, obj.get('content'));
          } else {
            Ember.set(content, key, obj);
          }
        }
      } else {
        // Could blow up if content is an empty promise.
        Ember.trySet(content, key, obj);
      }
    });

    this.initializeBuffer(onlyTheseKeys);

    if (empty(get(this, 'buffer'))) {
      set(this, 'hasBufferedChanges', false);
    }
  },

  discardBufferedChanges(onlyTheseKeys) {
    const buffer = get(this, 'buffer');

    this.initializeBuffer(onlyTheseKeys);

    keys(buffer).forEach((key) => {
      if (isArray(onlyTheseKeys) && onlyTheseKeys.indexOf(key) === -1) {
        return;
      }

      this.propertyWillChange(key);
      this.propertyDidChange(key);
    });

    if (empty(get(this, 'buffer'))) {
      set(this, 'hasBufferedChanges', false);
    }
  },

  /*
   * Determines if a given key has changed else returns false. Allows individual key lookups where
   * as hasBufferedChanged only looks at the whole buffer.
   */
  hasChanged(key) {
    const { buffer, content } = getProperties(this, ['buffer', 'content']);

    if (typeof key !== 'string' || typeof get(buffer, key) === 'undefined') {
      return false;
    }

    if (get(buffer, key) !== get(content, key)) {
      return true;
    }

    return false;
  },




  _handleProperty(key, obj) {
    this.propertyWillChange(key);

    if(Ember.isArray(obj)) {
      let proxifiedContent = obj.map((e) => proxify(e));
      this.buffer[key] = Ember.ArrayProxy.create({
        modelName: obj.get('firstObject.constructor.modelName'), // TODO
        content: proxifiedContent
      });
    } else {
      this.buffer[key] = proxify(obj);
    }

    this.propertyDidChange(key);

    return this.buffer[key];
  },
});

export default BufferedProxy;
