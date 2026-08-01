import Image from "next/image";
import Link from "next/link";

export default function Header() {
  return (
    <section>
      <Link href={"/"}>
        <Image
          src={"/images/LogoTMWTP.svg"}
          width={400}
          height={400}
          alt="Tell Me What To Play"
          loading="eager"
        />
      </Link>
    </section>
  );
}
