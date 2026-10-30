import { Capacitor } from "@capacitor/core";
import {
  Directory,
  Encoding,
  Filesystem
} from "@capacitor/filesystem";

globalThis.PlatformMobileNative = {
  Capacitor,
  Directory,
  Encoding,
  Filesystem
};
